/**
 * Standalone entry point for the Scout report background worker. Designed
 * to run as an ECS RunTask invocation, one task per report.
 *
 * Reads REPORT_ID from process.env (injected via ECS containerOverrides) plus
 * the standard set of env vars baked into the API task definition. Parses
 * the same Config schema as the API server, so the same SCOUT_* /
 * PLAY_CRICKET_* / VOYAGE_* / S3 settings apply unchanged.
 *
 * Wall-clock kill is the report agent's own timeout plus a 90s margin for
 * boot, DB connect, render, and S3 upload. If the agent's internal timeout
 * fires first, runReport already wrote 'failed' to the row before the
 * hard kill triggers; this is a last-resort backstop for orchestration
 * stalled outside the agent loop.
 */

import { context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import { createClient } from "@percy-main/db";
import { parseConfig } from "./config.ts";
import { createApiClient } from "./features/play-cricket/api-client.ts";
import { createVoyageClient } from "./features/scout/facts/voyage.ts";
import { runReport } from "./features/scout/report/run-report.ts";
import { createScoutReportStore } from "./lib/s3-scout-reports.ts";
import { createWorkerLogger } from "./lib/worker-logger.ts";

/**
 * Extract the propagated W3C trace context from env vars set by the
 * launcher (#197). Returns a Context that the rest of the worker
 * should run inside via context.with(...) so any spans/metrics it
 * emits are children of the API span that triggered this run.
 */
function extractTraceContext() {
  const carrier: Record<string, string> = {};
  if (process.env.OTEL_TRACEPARENT) {
    carrier.traceparent = process.env.OTEL_TRACEPARENT;
  }
  if (process.env.OTEL_TRACESTATE) {
    carrier.tracestate = process.env.OTEL_TRACESTATE;
  }
  return propagation.extract(ROOT_CONTEXT, carrier);
}

const RENDER_MARGIN_MS = 90_000;

const logger = createWorkerLogger("scout-report-worker");

const REPORT_ID = process.env.REPORT_ID;
if (!REPORT_ID) {
  logger.error("scout_report_worker_missing_env: REPORT_ID");
  process.exit(1);
}

const config = parseConfig(process.env);

if (!config.PLAY_CRICKET_API_TOKEN || !config.PLAY_CRICKET_SITE_ID) {
  logger.error(
    "scout_report_worker_missing_env: PLAY_CRICKET_API_TOKEN / PLAY_CRICKET_SITE_ID",
  );
  process.exit(1);
}
if (!config.SCOUT_DB_URL) {
  logger.error(
    "scout_report_worker_missing_env: SCOUT_DB_URL (read-only DB role)",
  );
  process.exit(1);
}

// Hard backstop. unref() lets the process exit naturally if everything
// finishes before the timer fires. runReport's own AbortSignal already
// fires at SCOUT_REPORT_TIMEOUT_MS, so this only fires if something
// outside the agent loop (boot, DB connect, render, S3 upload) stalls.
const HARD_KILL_MS = config.SCOUT_REPORT_TIMEOUT_MS + RENDER_MARGIN_MS;
setTimeout(() => {
  logger.error(
    { reportId: REPORT_ID, hardKillMs: HARD_KILL_MS },
    "scout_report_worker_wall_clock_kill",
  );
  process.exit(2);
}, HARD_KILL_MS).unref();

const { client: db } = createClient(config.DATABASE_URL);
const { client: dbReadonly } = createClient(config.SCOUT_DB_URL);
const playCricket = createApiClient({
  apiToken: config.PLAY_CRICKET_API_TOKEN,
  siteId: config.PLAY_CRICKET_SITE_ID,
});
const voyage = config.VOYAGE_API_KEY
  ? createVoyageClient({
      apiKey: config.VOYAGE_API_KEY,
      embedModel: config.VOYAGE_EMBED_MODEL,
      rerankModel: config.VOYAGE_RERANK_MODEL,
    })
  : undefined;
const scoutReports = createScoutReportStore(config);
const parentCtx = extractTraceContext();

logger.info({ reportId: REPORT_ID }, "scout_report_worker_started");

try {
  await context.with(parentCtx, () =>
    runReport(
      {
        db,
        dbReadonly,
        playCricket,
        config,
        voyage,
        scoutReports,
        logger,
      },
      REPORT_ID,
    ),
  );
  logger.info({ reportId: REPORT_ID }, "scout_report_worker_done");
  await db.destroy();
  await dbReadonly.destroy();
  process.exit(0);
} catch (err) {
  // runReport persists the failure to the row before throwing, so this
  // catch is purely about exit code + log. Unhandled errors here mean
  // something outside the pipeline (boot, DB connect) blew up; the row
  // may still be sitting in 'researching' if the failure happened before
  // the first phase write. ECS will retry per task settings (currently
  // none — the row just stays orphaned and a future operator query can
  // sweep it).
  logger.error({ err, reportId: REPORT_ID }, "scout_report_worker_failed");
  await db.destroy().catch(() => undefined);
  await dbReadonly.destroy().catch(() => undefined);
  process.exit(1);
}
