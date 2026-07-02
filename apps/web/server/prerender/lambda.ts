import { render } from "@/entry-server.js";
import { api, callApi } from "@/lib/api-client.js";
import {
  eventQueryOptions,
  isPageGone,
  navQueryOptions,
  newsArticleQueryOptions,
  pageByPathQueryOptions,
  peopleListQueryOptions,
  personQueryOptions,
} from "@/lib/content-queries.js";
import { assembleDocument } from "@/prerender/assemble-document.js";
import { buildHead } from "@/prerender/build-head.js";
import {
  snapshotInvalidationPath,
  snapshotKvsKey,
  snapshotS3Key,
} from "@/prerender/paths.js";
import {
  navHash,
  nextState,
  planReconcile,
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
import { QueryClient } from "@tanstack/react-query";
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
  siteOrigin: string;
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
    siteOrigin: process.env.SITE_ORIGIN ?? "https://www.percymain.org",
  };
  return envCache;
}

// Region comes from the Lambda's AWS_REGION; CloudFront + KVS are global
// services pinned to us-east-1.
const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({ region: "us-east-1" });
const kvs = new CloudFrontKeyValueStoreClient({ region: "us-east-1" });

let templateCache: string | undefined;
function loadTemplate(): string {
  // deploy-web zips the client build's dist/index.html alongside the
  // bundle as template.html.
  templateCache ??= readFileSync(
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
  const manifest = await callApi(api.GET("/api/content/prerender-manifest"));
  return manifest.items;
}

interface DetailData {
  title: string;
  description: string | null;
  body: unknown;
  metadata: Record<string, unknown>;
  publishedAt: string;
  updatedAt: string;
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
    },
    getEnv().siteOrigin,
  );
  return assembleDocument({ template, headHtml, appHtml, dehydratedState });
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
        if (attempt < 3 && (name === "ConflictException" || name === "PreconditionFailedException")) {
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
  for (const item of plan.toRender) {
    try {
      const html = await renderSnapshot(item, shared, template);
      if (html === null) {
        // Vanished between manifest and fetch; the next sync unrenders it.
        failed.add(item.url);
        continue;
      }
      await putObject(snapshotS3Key(item.url), html, "text/html; charset=utf-8");
      rendered.push(item.url);
    } catch (error) {
      console.error(`prerender render failed: ${item.url}`, error);
      failed.add(item.url);
    }
  }

  // Route new/changed snapshots and stop routing vanished ones. Failures
  // keep their previous state: a stale snapshot stays up (the SPA
  // refetches over it) rather than flapping to CSR.
  await kvsUpdate(
    rendered.map(snapshotKvsKey),
    plan.toUnrender.map(snapshotKvsKey),
  );

  await putObject(
    "sitemap.xml",
    buildSitemap(manifest, getEnv().siteOrigin),
    "application/xml",
  );
  await putObject(
    STATE_KEY,
    JSON.stringify(nextState(manifest, currentNavHash, failed)),
    "application/json",
  );

  const invalidationPaths =
    plan.mode === "diff"
      ? [
          ...rendered.map(snapshotInvalidationPath),
          ...plan.toUnrender.map(snapshotInvalidationPath),
          "/sitemap.xml",
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
  const [manifest, shared] = await Promise.all([fetchManifest(), fetchShared()]);
  const item = manifest.find((candidate) => candidate.url === url);
  if (!item) throw new Error(`URL not in the prerender manifest: ${url}`);
  const html = await renderSnapshot(item, shared, loadTemplate());
  if (html === null) throw new Error(`Content vanished while rendering ${url}`);
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
