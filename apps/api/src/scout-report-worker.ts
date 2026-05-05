/**
 * Standalone entry point for the Scout report background worker. Designed
 * to run as an ECS RunTask invocation, one task per report.
 *
 * Reads REPORT_ID from process.env (injected via ECS containerOverrides) plus
 * the standard set of env vars baked into the API task definition. Parses
 * the same Config schema as the API server, so the same SCOUT_* /
 * PLAY_CRICKET_* / VOYAGE_* / S3 settings apply unchanged.
 *
 * Wall-clock kill at 20 minutes — past that, DeepSeek's flash is presumed
 * stuck and we'd rather fail loudly than burn token budget indefinitely.
 * The scout_report row's status will already have been written to 'failed'
 * by runReport's progress flush before this fires (since it polls the DB
 * row); the kill is the last-resort backstop.
 */

import { createClient } from "@percy-main/db";
import { parseConfig } from "./config.ts";
import { createApiClient } from "./features/play-cricket/api-client.ts";
import { createVoyageClient } from "./features/scout/facts/voyage.ts";
import { runReport } from "./features/scout/report/run-report.ts";
import { createScoutReportStore } from "./lib/s3-scout-reports.ts";

const HARD_KILL_MS = 20 * 60_000;

const REPORT_ID = process.env.REPORT_ID;
if (!REPORT_ID) {
  console.error("Missing required env var: REPORT_ID");
  process.exit(1);
}

const config = parseConfig(process.env);

if (!config.PLAY_CRICKET_API_TOKEN || !config.PLAY_CRICKET_SITE_ID) {
  console.error(
    "Missing required env vars: PLAY_CRICKET_API_TOKEN / PLAY_CRICKET_SITE_ID",
  );
  process.exit(1);
}
if (!config.SCOUT_DB_URL) {
  console.error("Missing required env var: SCOUT_DB_URL (read-only DB role)");
  process.exit(1);
}

// Hard backstop. unref() lets the process exit naturally if everything
// finishes before the timer fires. The runReport pipeline already times
// out per-phase (researcher 12m, analyst 20m), so this only fires if
// something outside those budgets stalls.
setTimeout(() => {
  console.error(
    `scout_report_worker_wall_clock_kill reportId=${REPORT_ID} after ${HARD_KILL_MS}ms`,
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

console.log(`scout_report_worker_started reportId=${REPORT_ID}`);

try {
  await runReport(
    {
      db,
      dbReadonly,
      playCricket,
      config,
      voyage,
      scoutReports,
    },
    REPORT_ID,
  );
  console.log(`scout_report_worker_done reportId=${REPORT_ID}`);
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
  console.error("scout_report_worker_failed", err);
  await db.destroy().catch(() => undefined);
  await dbReadonly.destroy().catch(() => undefined);
  process.exit(1);
}
