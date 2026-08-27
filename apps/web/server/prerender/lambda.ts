import { render } from "@/entry-server.js";
import { API_BASE, api, callApi } from "@/lib/api-client.js";
import {
  eventQueryOptions,
  eventsListQueryOptions,
  isPageGone,
  navQueryOptions,
  newsArticleQueryOptions,
  pageByPathQueryOptions,
  peopleListQueryOptions,
  personQueryOptions,
} from "@/lib/content-queries.js";
import {
  gameQueryOptions,
  gameReportQueryOptions,
  gamesListQueryOptions,
} from "@/lib/games-queries.js";
import { assembleDocument } from "@/prerender/assemble-document.js";
import { buildHead } from "@/prerender/build-head.js";
import { gameHeadData, monthHeadData } from "@/prerender/game-meta.js";
import {
  snapshotInvalidationPath,
  snapshotKvsKey,
  snapshotS3Key,
} from "@/prerender/paths.js";
import {
  navHash,
  nextState,
  planReconcile,
  sitemapNeedsUpdate,
  type ManifestItem,
  type PrerenderState,
} from "@/prerender/reconcile.js";
import { buildSitemap } from "@/prerender/sitemap.js";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  UpdateKeysCommand,
} from "@aws-sdk/client-cloudfront-keyvaluestore";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
// Side-effect import: registers the pure-JS SigV4A implementation into
// @smithy/signature-v4's container. The KVS data plane signs with
// SigV4A, and the multi-region signer resolves the implementation from
// that container at runtime - in the bundled Lambda there is no
// node_modules for its optional lookup, so without this import every
// KVS call fails with "Neither CRT nor JS SigV4a implementation is
// available". The package declares sideEffects: true, so bundlers keep
// this.
//
// The import alone is not sufficient: the lockfile must resolve a
// SINGLE copy of @smithy/signature-v4, or the bundle gets two container
// objects and the registration lands in the one the signer doesn't
// read - same runtime error (PR #617 broke prod this way via a version
// split). scripts/check-ssr-sigv4a.mjs asserts this after every
// build:ssr; if it fails, run `pnpm dedupe @smithy/signature-v4`.
import "@smithy/signature-v4a";
import { QueryClient } from "@tanstack/react-query";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The prerenderer: renders live content to static HTML in the frontend
// bucket and keeps the CloudFront KeyValueStore + sitemap in step. Built
// from apps/web's SSR bundle by deploy-web (so its markup, asset hashes
// and template index.html are always the deployed SPA's), invoked by the
// API on publish-path mutations, by deploy-web after every web deploy,
// and by an EventBridge schedule as the drift/scheduled-publish backstop.
//
// One code path (sync) covers all of it: fetch the manifest, diff against
// the state file, render what changed, tear down what vanished. The API
// origin is baked into the bundle at build time via VITE_API_URL, exactly
// like the SPA.

export type PrerenderEvent =
  | { action: "reconcile" }
  | { action: "render-all" }
  | { action: "render"; url: string };

interface SyncSummary {
  mode: string;
  rendered: string[];
  unrendered: string[];
  failed: string[];
}

const STATE_KEY = "_prerender/state.json";
// CDN may cache for a day (invalidated on change); browsers must
// revalidate so a publish is visible on the next load.
const SNAPSHOT_CACHE_CONTROL =
  "public, max-age=0, s-maxage=86400, must-revalidate";

interface Env {
  frontendBucket: string;
  kvsArn: string;
  distributionId: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

let envCache: Env | undefined;
function getEnv(): Env {
  envCache ??= {
    frontendBucket: requiredEnv("FRONTEND_BUCKET"),
    kvsArn: requiredEnv("KVS_ARN"),
    distributionId: requiredEnv("CLOUDFRONT_DISTRIBUTION_ID"),
  };
  return envCache;
}

// Resolved independently of the AWS env so renderDocument works without
// any AWS configuration (local preview via scripts/prerender-preview.mjs).
function siteOrigin(): string {
  return process.env.SITE_ORIGIN ?? "https://www.percymain.org";
}

// Region comes from the Lambda's AWS_REGION; CloudFront + KVS are global
// services pinned to us-east-1.
const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({ region: "us-east-1" });
const kvs = new CloudFrontKeyValueStoreClient({ region: "us-east-1" });

let templateCache: string | undefined;
function loadTemplate(): string {
  // deploy-web zips the client build's dist/index.html alongside the
  // bundle as template.html. TEMPLATE_PATH is the local-preview override.
  templateCache ??= readFileSync(
    process.env.TEMPLATE_PATH ??
      join(dirname(fileURLToPath(import.meta.url)), "template.html"),
    "utf8",
  );
  return templateCache;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Data fetching ────────────────────────────────────────────────────────

async function fetchShared() {
  const [nav, people] = await Promise.all([
    callApi(api.GET("/api/content/nav")),
    callApi(api.GET("/api/content/people")),
  ]);
  return { nav, people };
}

type SharedData = Awaited<ReturnType<typeof fetchShared>>;

async function fetchManifest(): Promise<ManifestItem[]> {
  const [content, games] = await Promise.all([
    callApi(api.GET("/api/content/prerender-manifest")),
    fetchGamesManifest(),
  ]);
  return [...content.items, ...games];
}

/**
 * 404 means the games feature is off (no Play Cricket creds): zero
 * game/month items, content-only sync. Anything else - a Play Cricket
 * outage surfaces as a 500 here - aborts the whole sync, so a transient
 * failure can never read as "all games vanished" and tear down every
 * game snapshot. State and snapshots stay put; the 15-minute sweep
 * retries.
 */
async function fetchGamesManifest(): Promise<ManifestItem[]> {
  try {
    const manifest = await callApi(api.GET("/api/games/prerender-manifest"));
    return manifest.items;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return [];
    throw error;
  }
}

interface DetailData {
  title: string;
  description: string | null;
  body: unknown;
  metadata: Record<string, unknown>;
  publishedAt: string;
  updatedAt: string;
  /** Absolute og:image override (game pages use the API scorecard PNG). */
  ogImageUrl?: string;
}

/**
 * The page/article/profile/event backing `item`, through the same query
 * options the SPA reads - so the dehydrated cache entry lands under
 * exactly the key the component hydrates from. Null when the item
 * vanished (404) or was taken down (410) between manifest and fetch; the
 * next reconcile tears it down.
 */
async function fetchDetail(
  queryClient: QueryClient,
  item: ManifestItem,
): Promise<DetailData | null> {
  switch (item.kind) {
    case "page": {
      const data = await queryClient.fetchQuery(
        pageByPathQueryOptions(item.url),
      );
      return data === null || isPageGone(data) ? null : data;
    }
    case "news": {
      const data = await queryClient.fetchQuery(
        newsArticleQueryOptions(item.slug),
      );
      return data ?? null;
    }
    case "event": {
      const data = await queryClient.fetchQuery(eventQueryOptions(item.slug));
      return data ?? null;
    }
    case "person": {
      const data = await queryClient.fetchQuery(personQueryOptions(item.slug));
      return data === null || isPageGone(data) ? null : data;
    }
    case "game": {
      let game;
      try {
        game = await queryClient.fetchQuery(gameQueryOptions(item.slug));
      } catch (error) {
        // Vanished from Play Cricket between manifest and fetch.
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
      // Seed the report the page reads (its queryFn maps 404 to null, so
      // report-less games dehydrate a null entry rather than pending).
      await queryClient.fetchQuery(gameReportQueryOptions(item.slug));
      const head = gameHeadData(game);
      return {
        title: head.title,
        description: head.description,
        body: undefined,
        metadata: head.metadata,
        publishedAt: item.publishedAt,
        updatedAt: item.updatedAt,
        ogImageUrl: `${API_BASE}/og/game/${item.slug}`,
      };
    }
    case "calendar-month": {
      const [yearRaw, monthName] = item.slug.split("/");
      const year = Number(yearRaw);
      if (!monthName || !Number.isFinite(year)) return null;
      await Promise.all([
        queryClient.fetchQuery(gamesListQueryOptions(year)),
        queryClient.fetchQuery(eventsListQueryOptions()),
      ]);
      const head = monthHeadData(year, monthName);
      return {
        title: head.title,
        description: head.description,
        body: undefined,
        metadata: {},
        publishedAt: item.publishedAt,
        updatedAt: item.updatedAt,
      };
    }
  }
}

// ── Rendering ────────────────────────────────────────────────────────────

async function renderSnapshot(
  item: ManifestItem,
  shared: SharedData,
  template: string,
): Promise<string | null> {
  // Fresh client per document: no state bleed between pages, and its
  // dehydrated form is exactly this page's data (nav + people + detail).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1 } },
  });
  queryClient.setQueryData(navQueryOptions().queryKey, shared.nav);
  queryClient.setQueryData(peopleListQueryOptions().queryKey, shared.people);

  const detail = await fetchDetail(queryClient, item);
  if (detail === null) return null;

  const { appHtml, dehydratedState } = await render(item.url, queryClient);
  const headHtml = buildHead(
    {
      kind: item.kind,
      url: item.url,
      title: detail.title,
      description: detail.description,
      metadata: detail.metadata,
      body: detail.body,
      publishedAt: detail.publishedAt,
      updatedAt: detail.updatedAt,
      ogImageUrl: detail.ogImageUrl,
    },
    siteOrigin(),
  );
  return assembleDocument({ template, headHtml, appHtml, dehydratedState });
}

/**
 * Render one URL to its full document WITHOUT touching AWS - the local
 * preview / smoke path (scripts/prerender-preview.mjs) and the seam the
 * deploy pipeline's render-all is built on.
 */
export async function renderDocument(url: string): Promise<string> {
  const [manifest, shared] = await Promise.all([
    fetchManifest(),
    fetchShared(),
  ]);
  const item = manifest.find((candidate) => candidate.url === url);
  if (!item) throw new Error(`URL not in the prerender manifest: ${url}`);
  const html = await renderSnapshot(item, shared, loadTemplate());
  if (html === null) throw new Error(`Content vanished while rendering ${url}`);
  return html;
}

// ── S3 ───────────────────────────────────────────────────────────────────

async function putObject(
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: getEnv().frontendBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: SNAPSHOT_CACHE_CONTROL,
    }),
  );
}

async function readState(): Promise<PrerenderState | null> {
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: getEnv().frontendBucket, Key: STATE_KEY }),
    );
    const raw: unknown = JSON.parse(
      (await response.Body?.transformToString()) ?? "",
    );
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as PrerenderState).v === 1
    ) {
      return raw as PrerenderState;
    }
    return null;
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}

// ── KVS ──────────────────────────────────────────────────────────────────

/**
 * Batched, ETag-guarded key sync. Chunked because UpdateKeys caps the
 * batch size; the ETag is refetched per chunk (each update rotates it)
 * and conflicts retry - concurrent syncs are already rare (the Lambda
 * runs with reserved concurrency 1), this covers out-of-band edits.
 */
async function kvsUpdate(puts: string[], deletes: string[]): Promise<void> {
  const CHUNK = 25;
  const ops = [
    ...puts.map((key) => ({ put: true, key })),
    ...deletes.map((key) => ({ put: false, key })),
  ];
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    for (let attempt = 1; ; attempt++) {
      const { ETag } = await kvs.send(
        new DescribeKeyValueStoreCommand({ KvsARN: getEnv().kvsArn }),
      );
      try {
        await kvs.send(
          new UpdateKeysCommand({
            KvsARN: getEnv().kvsArn,
            IfMatch: ETag,
            Puts: chunk
              .filter((op) => op.put)
              .map((op) => ({ Key: op.key, Value: "1" })),
            Deletes: chunk
              .filter((op) => !op.put)
              .map((op) => ({ Key: op.key })),
          }),
        );
        break;
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (
          attempt < 3 &&
          (name === "ConflictException" ||
            name === "PreconditionFailedException")
        ) {
          continue;
        }
        throw error;
      }
    }
  }
}

// ── CloudFront invalidation ─────────────────────────────────────────────

async function invalidate(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: getEnv().distributionId,
      InvalidationBatch: {
        CallerReference: `prerender-${Date.now().toString()}-${Math.random().toString(36).slice(2)}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    }),
  );
}

// ── Sync ─────────────────────────────────────────────────────────────────

async function sync(force: boolean): Promise<SyncSummary> {
  const template = loadTemplate();
  const [manifest, shared, state] = await Promise.all([
    fetchManifest(),
    fetchShared(),
    readState(),
  ]);
  const currentNavHash = navHash(shared.nav.items);
  const plan = planReconcile({ manifest, state, currentNavHash, force });
  console.log(
    `prerender sync: mode=${plan.mode} render=${plan.toRender.length.toString()} unrender=${plan.toUnrender.length.toString()}`,
  );

  const rendered: string[] = [];
  const failed = new Set<string>();
  // Not-yet-processed render targets; treated as "failed" in mid-sync
  // state flushes so a resumed sync retries exactly the remainder.
  const pendingUrls = new Set(plan.toRender.map((item) => item.url));
  // With games in the manifest a render-all is ~350 documents; flushing
  // KVS routing, state and invalidations every batch turns a Lambda
  // timeout from "start over, never converge" into "resume from where
  // the last flush left off on the next sweep".
  const FLUSH_EVERY = 25;
  let unflushed: string[] = [];

  const flushProgress = async () => {
    await kvsUpdate(unflushed.map(snapshotKvsKey), []);
    await putObject(
      STATE_KEY,
      JSON.stringify(
        nextState(
          manifest,
          currentNavHash,
          // sitemap.xml is only rewritten at the end of the sync, so a
          // mid-sync flush must carry the stored hash - flushing the new
          // one would make a resumed sync skip the sitemap rewrite.
          state?.sitemapHash,
          new Set([...failed, ...pendingUrls]),
        ),
      ),
      "application/json",
    );
    // Full-render modes invalidate the whole prefix (one wildcard path
    // per flush) rather than hundreds of per-document paths.
    await invalidate(
      plan.mode === "diff"
        ? unflushed.map(snapshotInvalidationPath)
        : ["/_prerender/*"],
    );
    unflushed = [];
  };

  for (const item of plan.toRender) {
    try {
      const html = await renderSnapshot(item, shared, template);
      pendingUrls.delete(item.url);
      if (html === null) {
        // Vanished between manifest and fetch; the next sync unrenders it.
        failed.add(item.url);
        continue;
      }
      await putObject(
        snapshotS3Key(item.url),
        html,
        "text/html; charset=utf-8",
      );
      rendered.push(item.url);
      unflushed.push(item.url);
      if (unflushed.length >= FLUSH_EVERY) await flushProgress();
    } catch (error) {
      pendingUrls.delete(item.url);
      console.error(`prerender render failed: ${item.url}`, error);
      failed.add(item.url);
    }
  }

  // Route the remaining snapshots and stop routing vanished ones.
  // Failures keep their previous state: a stale snapshot stays up (the
  // SPA refetches over it) rather than flapping to CSR.
  const finalBatch = unflushed;
  unflushed = [];
  await kvsUpdate(
    finalBatch.map(snapshotKvsKey),
    plan.toUnrender.map(snapshotKvsKey),
  );

  const sitemap = buildSitemap(manifest, siteOrigin());
  const sitemapHash = createHash("sha256").update(sitemap).digest("hex");
  const sitemapChanged = sitemapNeedsUpdate(
    plan.mode,
    state?.sitemapHash,
    sitemapHash,
  );
  if (sitemapChanged) {
    await putObject("sitemap.xml", sitemap, "application/xml");
  }

  // The 15-minute sweep mostly changes nothing; a clean diff sweep skips
  // the state write too (it would be identical) so it costs zero S3
  // writes and zero CloudFront invalidations. Write order matters: the
  // sitemap lands before the state that records its hash, so a crash
  // between the two rewrites the sitemap next sweep instead of
  // stranding a stale one.
  const noop =
    plan.mode === "diff" &&
    plan.toRender.length === 0 &&
    plan.toUnrender.length === 0 &&
    !sitemapChanged;
  if (!noop) {
    await putObject(
      STATE_KEY,
      JSON.stringify(nextState(manifest, currentNavHash, sitemapHash, failed)),
      "application/json",
    );
  }

  // Earlier flushes already invalidated their batches; only the final
  // batch, unrendered urls and the sitemap (when it changed) remain.
  const invalidationPaths =
    plan.mode === "diff"
      ? [
          ...finalBatch.map(snapshotInvalidationPath),
          ...plan.toUnrender.map(snapshotInvalidationPath),
          ...(sitemapChanged ? ["/sitemap.xml"] : []),
        ]
      : ["/_prerender/*", "/sitemap.xml"];
  await invalidate(invalidationPaths);

  if (plan.toUnrender.length > 0) {
    // KVS deletes propagate in seconds; waiting before removing the
    // objects keeps the window where the function still routes to a
    // deleted object (S3 AccessDenied) effectively closed.
    await sleep(5000);
    for (const url of plan.toUnrender) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: getEnv().frontendBucket,
          Key: snapshotS3Key(url),
        }),
      );
    }
  }

  const summary: SyncSummary = {
    mode: plan.mode,
    rendered,
    unrendered: plan.toUnrender,
    failed: [...failed],
  };
  console.log(`prerender sync done: ${JSON.stringify(summary)}`);
  return summary;
}

/** Render one URL, bypassing state/sitemap - the rollout/debug tool. */
async function renderOne(url: string): Promise<SyncSummary> {
  const html = await renderDocument(url);
  await putObject(snapshotS3Key(url), html, "text/html; charset=utf-8");
  await kvsUpdate([snapshotKvsKey(url)], []);
  await invalidate([snapshotInvalidationPath(url)]);
  return { mode: "single", rendered: [url], unrendered: [], failed: [] };
}

export async function handler(event: PrerenderEvent): Promise<SyncSummary> {
  switch (event.action) {
    case "reconcile":
      return await sync(false);
    case "render-all":
      return await sync(true);
    case "render":
      return await renderOne(event.url);
  }
}
