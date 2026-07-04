/**
 * Standalone entry point for Play Cricket sync.
 * Designed to run as a scheduled ECS task — not part of the web server.
 *
 * Environment variables are read directly from process.env
 * (injected by the ECS task definition).
 */

import { LambdaClient } from "@aws-sdk/client-lambda";
import { createClient } from "@percy-main/db";
import { createApiClient } from "./features/play-cricket/api-client.ts";
import { createRvClient } from "./features/play-cricket/rv-client.ts";
import { runSync } from "./features/play-cricket/sync.ts";
import { invokePrerenderReconcile } from "./lib/prerender-trigger.ts";
import { withSpan } from "./lib/tracing.ts";
import { createWorkerLogger } from "./lib/worker-logger.ts";

const logger = createWorkerLogger("sync-runner");

const DATABASE_URL = process.env.DATABASE_URL;
const PLAY_CRICKET_API_TOKEN = process.env.PLAY_CRICKET_API_TOKEN;
const PLAY_CRICKET_SITE_ID = process.env.PLAY_CRICKET_SITE_ID;
// ResultsVault shared secret (lifted from InteractSport's Match Centre
// SPA bundle). Optional: when unset, the BBB ingest is skipped — the PC
// sync still runs end-to-end. See BALL_BY_BALL_FETCHING.md (gitignored)
// for how to obtain / rotate this.
const RV_SHARED_SECRET = process.env.RV_SHARED_SECRET;

if (!DATABASE_URL) throw new Error("Missing required env var: DATABASE_URL");
if (!PLAY_CRICKET_API_TOKEN)
  throw new Error("Missing required env var: PLAY_CRICKET_API_TOKEN");
if (!PLAY_CRICKET_SITE_ID)
  throw new Error("Missing required env var: PLAY_CRICKET_SITE_ID");

// Optional: when set (the ECS task inherits the API service's env), the
// runner pings the prerenderer after writing results so game snapshots
// refresh without waiting for the 15-minute sweep.
const PRERENDER_LAMBDA_ARN = process.env.PRERENDER_LAMBDA_ARN;

/**
 * Awaited (a fire-and-forget invoke would die with process.exit), but
 * never allowed to change the exit code - the sweep is the backstop.
 * Runs after completed-with-errors syncs too: partial runs still write
 * match_result rows that prerendered game pages render.
 */
async function triggerPrerenderReconcile(): Promise<void> {
  if (!PRERENDER_LAMBDA_ARN) return;
  try {
    await invokePrerenderReconcile(
      new LambdaClient({ region: process.env.AWS_REGION }),
      PRERENDER_LAMBDA_ARN,
    );
    logger.info("prerender_reconcile_triggered");
  } catch (error) {
    logger.error({ err: error }, "prerender_reconcile_invoke_failed");
  }
}

const { client } = createClient(DATABASE_URL);
const api = createApiClient({
  apiToken: PLAY_CRICKET_API_TOKEN,
  siteId: PLAY_CRICKET_SITE_ID,
});
const rv = RV_SHARED_SECRET
  ? createRvClient({ sharedSecret: RV_SHARED_SECRET })
  : null;

try {
  logger.info({ withRv: Boolean(rv) }, "play_cricket_sync_started");

  const sync = runSync(client, api, rv, logger);
  // Throw out of withSpan if the sync returned a non-empty errors
  // list — withSpan only marks ERROR on a thrown error, so a
  // completed-with-errors run would otherwise look successful in
  // OTel. The thrown PlayCricketSyncErrorsError is caught below to
  // restore the per-error logging + exit-1 behaviour.
  let result;
  try {
    result = await withSpan(
      "play_cricket.sync.run",
      { siteId: PLAY_CRICKET_SITE_ID, withRv: Boolean(rv) },
      async () => {
        const r = await sync({ siteId: PLAY_CRICKET_SITE_ID });
        if (r.errors.length > 0) {
          const err = new Error(
            `play_cricket_sync_completed_with_${r.errors.length}_errors`,
          );
          (err as Error & { syncResult?: typeof r }).syncResult = r;
          throw err;
        }
        return r;
      },
    );
  } catch (err) {
    const syncResult = (
      err as { syncResult?: { errors: string[]; matchesProcessed: number } }
    ).syncResult;
    if (syncResult) {
      // Treat as completed-with-errors: log + exit 1, span already
      // marked ERROR by withSpan.
      logger.error(
        { errorCount: syncResult.errors.length, errors: syncResult.errors },
        "play_cricket_sync_completed_with_errors",
      );
      await triggerPrerenderReconcile();
      await client.destroy();
      process.exit(1);
    }
    throw err;
  }

  // Reaching here means errors.length === 0 (otherwise the throw
  // above would have routed via the catch).
  logger.info(
    { matchesProcessed: result.matchesProcessed },
    "play_cricket_sync_complete",
  );

  await triggerPrerenderReconcile();
  await client.destroy();
  process.exit(0);
} catch (error) {
  logger.error({ err: error }, "play_cricket_sync_failed");
  await client.destroy().catch(() => undefined);
  process.exit(1);
}
