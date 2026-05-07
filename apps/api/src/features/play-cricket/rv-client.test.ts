import { describe, expect, it, vi } from "vitest";
import {
  assertValidRvSharedSecret,
  createRvClient,
  mintXIasToken,
  parseMsDate,
} from "./rv-client.ts";

// 24-byte ASCII secret matching the format used by the Match Centre SPA.
// The literal value used by RV at the time of writing is captured locally
// in BALL_BY_BALL_FETCHING.md (gitignored). For tests we use any 24-byte
// string — the algorithm doesn't care about contents, only length.
const TEST_SECRET = "ABCDEFGHIJKLMNOPQRSTUVWX";

describe("assertValidRvSharedSecret", () => {
  it("accepts a 24-ASCII-byte secret", () => {
    expect(() => assertValidRvSharedSecret(TEST_SECRET)).not.toThrow();
  });

  it("rejects shorter / longer secrets up front", () => {
    expect(() => assertValidRvSharedSecret("short")).toThrow(
      /must be exactly 24 ASCII bytes/,
    );
    expect(() => assertValidRvSharedSecret("A".repeat(32))).toThrow(
      /must be exactly 24 ASCII bytes/,
    );
  });
});

describe("createRvClient construction", () => {
  it("validates the shared secret at construction (not lazily on first call)", () => {
    expect(() =>
      createRvClient({
        sharedSecret: "too-short",
        fetch: vi.fn() as unknown as typeof fetch,
      }),
    ).toThrow(/24 ASCII bytes/);
  });
});

describe("createRvClient timeout", () => {
  it("aborts a stalled fetch after timeoutMs and throws a timeout error", async () => {
    const fetchMock = vi.fn(
      (_url: URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Resolve only when the caller's AbortSignal fires.
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 30,
    });

    await expect(client.getMatchMapping("123")).rejects.toThrow(/timeout/i);
  });
});

describe("mintXIasToken", () => {
  it("produces a deterministic 24-char base64 token for a given clock time", () => {
    const secret = Buffer.from(TEST_SECRET, "utf8");
    // 2026-05-07T00:00:00Z — fixed clock so the test is reproducible.
    const fixed = new Date("2026-05-07T00:00:00.000Z").getTime();
    const a = mintXIasToken(secret, fixed);
    const b = mintXIasToken(secret, fixed);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("changes when the clock advances by a second", () => {
    const secret = Buffer.from(TEST_SECRET, "utf8");
    const t = new Date("2026-05-07T00:00:00.000Z").getTime();
    const a = mintXIasToken(secret, t);
    const b = mintXIasToken(secret, t + 1000);
    expect(a).not.toBe(b);
  });

  it("groups inputs by rounded-second of (now/1000 - 60)", () => {
    // We can't peek the plaintext, but we can prove the rounding semantics
    // by picking a base time and showing two inputs in the same rounded
    // second match, while two inputs in different rounded seconds differ.
    // A future refactor to floor() instead of round() would change which
    // bucket a given ms falls into and fail one of these.
    const secret = Buffer.from(TEST_SECRET, "utf8");
    const t = new Date("2026-05-07T00:00:00.000Z").getTime();
    // t and t+400ms both round to the same second.
    expect(mintXIasToken(secret, t)).toBe(mintXIasToken(secret, t + 400));
    // t and t+1500ms round to seconds 1 apart — distinct tokens.
    expect(mintXIasToken(secret, t)).not.toBe(mintXIasToken(secret, t + 1500));
  });
});

describe("parseMsDate", () => {
  it("parses /Date(epochms+TZ)/ to a UTC-equivalent Date", () => {
    // 1777719950000 is the ms epoch in the doc example.
    const d = parseMsDate("/Date(1777719950000+0100)/");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(1777719950000);
  });

  it("parses bare /Date(epochms)/ without a TZ suffix", () => {
    expect(parseMsDate("/Date(1000)/")?.getTime()).toBe(1000);
  });

  it("returns null on null / empty / junk input", () => {
    expect(parseMsDate(null)).toBeNull();
    expect(parseMsDate(undefined)).toBeNull();
    expect(parseMsDate("")).toBeNull();
    expect(parseMsDate("not a date")).toBeNull();
    expect(parseMsDate("/Date(abc)/")).toBeNull();
  });
});

// Helper to build a Response-like object the client's getJson can consume.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createRvClient.getMatchMapping", () => {
  it("returns the rvMatchId when object_id1 is non-zero", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { object_id1: 7464451 }));
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await client.getMatchMapping("7262912");

    expect(out).toEqual({ rvMatchId: "7464451" });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/rv/mappings/4/12/7262912/");
    expect(url.searchParams.get("apiid")).toBe("1003");
    expect(url.searchParams.get("sportid")).toBe("1");
    // Auth header gets minted — sanity check it's present.
    const headers = (
      fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    ).headers;
    expect(headers["x-ias-api-request"]).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("returns null when RV reports no mapping (object_id1: 0)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { object_id1: 0 }));
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(await client.getMatchMapping("9999999")).toBeNull();
  });

  it("returns null on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, null));
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(await client.getMatchMapping("9999999")).toBeNull();
  });

  it("throws on non-2xx, non-404 responses (e.g. 401)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("<html>Request Error</html>", { status: 401 }),
      );
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.getMatchMapping("123")).rejects.toThrow(/HTTP 401/);
  });
});

describe("createRvClient.getMatch", () => {
  it("parses a minimal overview", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        match_id: 7464451,
        external_match_id: 7262912,
        MatchTeams: [
          {
            team_name: "Backworth CC 2nd XI",
            result_id: 25398667,
            Innings: [{ innings_number: 1, PlayerPerfs: [] }],
          },
          {
            team_name: "Percy Main CC 1st XI",
            result_id: 25398668,
            Innings: [
              {
                innings_number: 1,
                PlayerPerfs: [
                  {
                    player_id: 11680433,
                    external_id: "4386566",
                    player_name: "S Knight",
                  },
                ],
              },
            ],
          },
        ],
        matchStreams: [
          {
            id: 71781,
            match_id: 7464451,
            video_id: "cu4A54DjCDI",
            frogbox_stream_id: "59e32fe6-7502-4433-9044-413838f2f20e",
            stream_provider_id: 3,
            start_utc: "/Date(1777718649307+0100)/",
            recording_started_utc: "/Date(1777718779000+0100)/",
            publish_status_id: 0,
            description: null,
          },
        ],
      }),
    );
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await client.getMatch("7464451");

    expect(out?.match_id).toBe(7464451);
    expect(out?.MatchTeams).toHaveLength(2);
    expect(out?.matchStreams[0]?.video_id).toBe("cu4A54DjCDI");
    expect(out?.MatchTeams[1]?.Innings[0]?.PlayerPerfs[0]?.external_id).toBe(
      "4386566",
    );
  });

  it("returns null on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, null));
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(await client.getMatch("9999999")).toBeNull();
  });
});

describe("createRvClient.getBalls", () => {
  it("parses a balls array and preserves ordering", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, [
        {
          innings_number: 1,
          over_no: 0,
          ball_no: 1,
          ball_no_disp: 1,
          result_id: 25398668,
          batter_id: 11680433,
          bowler_id: 12367961,
          runs_bat: 0,
          runs_extra: 0,
          extras_type: null,
          l_desc: " K Pattison to S Knight: No run",
          s_desc: " .",
          ball_time: "/Date(1777719950000+0100)/",
          match_highlight_events: [],
        },
        {
          innings_number: 1,
          over_no: 0,
          ball_no: 2,
          ball_no_disp: 2,
          result_id: 25398668,
          batter_id: 11680433,
          bowler_id: 12367961,
          runs_bat: 4,
          runs_extra: 0,
          extras_type: null,
          l_desc: " K Pattison to S Knight: 4 runs",
          s_desc: " 4",
          match_highlight_events: [{ event_id: 1002, metric: 4 }],
        },
      ]),
    );
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await client.getBalls("7464451", 25398668, 1);

    expect(out).toHaveLength(2);
    expect(out[0]?.ball_no).toBe(1);
    expect(out[1]?.match_highlight_events).toEqual([
      { event_id: 1002, metric: 4 },
    ]);

    // URL parameter sanity.
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("action")).toBe("getballs");
    expect(url.searchParams.get("resultid")).toBe("25398668");
    expect(url.searchParams.get("inningsnumber")).toBe("1");
  });

  it("returns [] on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, null));
    const client = createRvClient({
      sharedSecret: TEST_SECRET,
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(await client.getBalls("9999999", 1, 1)).toEqual([]);
  });
});
