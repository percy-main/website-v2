import crypto from "node:crypto";
import {
  RvBallsResponse,
  RvMappingInfo,
  RvMatchOverview,
  type RvBall,
  type RvMatchOverview as RvMatchOverviewType,
} from "./rv-schemas.ts";

/**
 * Static-message errors so NR Errors view groups RV failures
 * together. Variable values (path / status / bodyPreview / timeout)
 * live as properties.
 */
export class RvApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly bodyPreview: string,
    options?: { cause?: unknown },
  ) {
    super("rv_api_error", options);
    this.name = "RvApiError";
  }
}

export class RvApiTimeoutError extends Error {
  constructor(
    public readonly path: string,
    public readonly timeoutMs: number,
    options?: { cause?: unknown },
  ) {
    super("rv_api_timeout", options);
    this.name = "RvApiTimeoutError";
  }
}

// ResultsVault read-only client. Reverse-engineered from InteractSport's
// Match Centre SPA — see BALL_BY_BALL_FETCHING.md (local, gitignored) for
// the full how-and-why. This module deliberately knows nothing about our
// PC sync; callers wire it up.
//
// Auth is a 3DES-ECB-encrypted current Unix-second timestamp, base64'd
// into the `x-ias-api-request` header. Tokens are valid for ~30 minutes
// server-side; we just mint per-request — it's microseconds of CPU.

const RV_BASE = "https://api.resultsvault.co.uk";
const RV_TENANT_ID = "130000"; // ECB master_entity_id (= 13e4 in the bundle)
const RV_API_ID = "1003";
const RV_SPORT_ID = "1";

// Mapping path constants — see the mappings endpoint section of the doc.
// 4 = mapping_instance (PC↔RV bind for matches), 12 = object_type_id
// (match). These are baked into the SPA's call sites; they do not vary
// across tenants we'd plausibly serve.
const RV_MAPPING_INSTANCE = "4";
const RV_OBJECT_TYPE_MATCH = "12";

export interface RvClientConfig {
  /**
   * The shared secret embedded in the Match Centre SPA bundle. 24 ASCII
   * bytes, used directly as the 3DES key (NOT decoded as hex). Rotates
   * approximately never — but if 401s start, re-grep the bundle. See
   * BALL_BY_BALL_FETCHING.md for the exact procedure.
   */
  sharedSecret: string;
  /**
   * Override fetch — primarily for tests. Defaults to global fetch.
   */
  fetch?: typeof fetch;
  /**
   * Per-request timeout in milliseconds. Defaults to 15s. RV is hit
   * inside the per-match sync loop, so a stalled connection would
   * otherwise hold the entire sync hostage even though RV failures are
   * meant to be non-fatal.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const SHARED_SECRET_BYTES = 24; // 3DES needs exactly 24 bytes of key material.

/**
 * Validate the shared-secret byte length up front so a misconfigured
 * RV_SHARED_SECRET fails at boot rather than at first crypto call.
 */
export function assertValidRvSharedSecret(secret: string): void {
  const bytes = Buffer.from(secret, "utf8").length;
  if (bytes !== SHARED_SECRET_BYTES) {
    throw new Error(
      `RV_SHARED_SECRET must be exactly ${String(
        SHARED_SECRET_BYTES,
      )} ASCII bytes (got ${String(bytes)}).`,
    );
  }
}

export interface RvMatchMapping {
  rvMatchId: string;
}

export interface RvClient {
  /**
   * Look up the RV match id for a given Play Cricket match id.
   *
   * Resolves to `null` when no mapping exists (RV returns
   * `object_id1: 0`) or when the endpoint 404s. Throws on any other
   * non-2xx — callers should let the existing per-match try/catch in
   * the sync handle those.
   */
  getMatchMapping(pcMatchId: string): Promise<RvMatchMapping | null>;

  /**
   * Match overview by RV match id. Resolves to `null` on 404 (RV doesn't
   * recognise the match — common; matches without live scoring just
   * aren't in their backend).
   */
  getMatch(rvMatchId: string): Promise<RvMatchOverviewType | null>;

  /**
   * Ball-by-ball for a single team-innings. Resolves to `[]` for empty
   * innings (the common "this innings hasn't been played yet" case) or
   * for 404 — callers should treat empty as "no data, move on".
   */
  getBalls(
    rvMatchId: string,
    rvResultId: string | number,
    inningsNumber: number,
  ): Promise<RvBall[]>;
}

export function createRvClient(config: RvClientConfig): RvClient {
  assertValidRvSharedSecret(config.sharedSecret);
  const fetchImpl = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secretBuf = Buffer.from(config.sharedSecret, "utf8");

  function mintToken(): string {
    return mintXIasToken(secretBuf);
  }

  async function getJson(url: URL): Promise<{
    status: number;
    body: unknown;
  }> {
    // Bound the request — the per-match try/catch in sync logs RV
    // failures non-fatally, but only if the request actually returns.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: {
          "x-ias-api-request": mintToken(),
          accept: "application/json",
        },
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) {
        throw new RvApiTimeoutError(url.pathname, timeoutMs, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return { status: 404, body: null };
    const text = await res.text();
    if (!res.ok) {
      throw new RvApiError(url.pathname, res.status, text.slice(0, 300));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new RvApiError(url.pathname, res.status, text.slice(0, 300), {
        cause: err,
      });
    }
    return { status: res.status, body: parsed };
  }

  return {
    async getMatchMapping(pcMatchId: string): Promise<RvMatchMapping | null> {
      const url = new URL(
        `${RV_BASE}/rv/mappings/${RV_MAPPING_INSTANCE}/${RV_OBJECT_TYPE_MATCH}/${encodeURIComponent(
          pcMatchId,
        )}/`,
      );
      url.searchParams.set("apiid", RV_API_ID);
      url.searchParams.set("sportid", RV_SPORT_ID);

      const { status, body } = await getJson(url);
      if (status === 404) return null;
      const parsed = RvMappingInfo.parse(body);
      // RV signals "no mapping" by returning object_id1: 0 alongside a
      // 200 — treat that the same as 404.
      if (!parsed.object_id1) return null;
      return { rvMatchId: String(parsed.object_id1) };
    },

    async getMatch(rvMatchId: string): Promise<RvMatchOverviewType | null> {
      const url = new URL(
        `${RV_BASE}/rv/${RV_TENANT_ID}/matches/${encodeURIComponent(rvMatchId)}/`,
      );
      url.searchParams.set("apiid", RV_API_ID);

      const { status, body } = await getJson(url);
      if (status === 404) return null;
      return RvMatchOverview.parse(body);
    },

    async getBalls(
      rvMatchId: string,
      rvResultId: string | number,
      inningsNumber: number,
    ): Promise<RvBall[]> {
      const url = new URL(
        `${RV_BASE}/rv/${RV_TENANT_ID}/matches/${encodeURIComponent(rvMatchId)}/`,
      );
      url.searchParams.set("apiid", RV_API_ID);
      url.searchParams.set("action", "getballs");
      url.searchParams.set("sportid", RV_SPORT_ID);
      url.searchParams.set("resultid", String(rvResultId));
      url.searchParams.set("inningsnumber", String(inningsNumber));

      const { status, body } = await getJson(url);
      if (status === 404) return [];
      return RvBallsResponse.parse(body);
    },
  };
}

/**
 * Mint a fresh `x-ias-api-request` token.
 *
 * Algorithm (lifted from the Match Centre SPA, function `ce(e)`):
 *   plaintext = String(round(Date.now()/1000 - 60))     // ASCII decimal
 *   padded    = plaintext + PKCS7 to next 8-byte block
 *   ct        = 3DES-ECB(key=sharedSecret-as-ASCII, padded)
 *   token     = base64(ct)
 *
 * Exposed for unit testing; ordinary callers go through `createRvClient`.
 */
export function mintXIasToken(
  secret: Buffer,
  now: number = Date.now(),
): string {
  const ts = Math.round(now / 1000 - 60).toString();
  const padLen = 8 - (ts.length % 8); // PKCS7: always 1..8
  const data = Buffer.concat([
    Buffer.from(ts, "ascii"),
    Buffer.alloc(padLen, padLen),
  ]);
  // Node's `des-ede3-ecb` expects a 24-byte key for 3DES. ECB mode takes
  // a null IV. We pad manually and disable Node's auto-padding so the
  // ciphertext length matches the SPA's exactly.
  const cipher = crypto.createCipheriv("des-ede3-ecb", secret, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString(
    "base64",
  );
}

/**
 * Parse Microsoft DateTime serialisation: `"/Date(1777719950000+0100)/"`.
 * Returns `null` for null/empty/junk inputs so junk timestamps don't
 * abort an entire ingest.
 */
export function parseMsDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(input);
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}
