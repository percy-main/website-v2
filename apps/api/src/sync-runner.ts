/**
 * Standalone entry point for Play Cricket sync.
 * Designed to run as a scheduled ECS task — not part of the web server.
 *
 * Environment variables are read directly from process.env
 * (injected by the ECS task definition).
 */

import { createClient } from "@percy-main/db";
import { createApiClient } from "./features/play-cricket/api-client.ts";
import { createRvClient } from "./features/play-cricket/rv-client.ts";
import { runSync } from "./features/play-cricket/sync.ts";
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

const { client } = createClient(DATABASE_URL);
const api = createApiClient({
  apiToken: PLAY_CRICKET_API_TOKEN,
  siteId: PLAY_CRICKET_SITE_ID,
});
const rv = RV_SHARED_SECRET
  ? createRvClient({ sharedSecret: RV_SHARED_SECRET })
  : null;

try {
  logger.info(
    { withRv: Boolean(rv) },
    "play_cricket_sync_started",
  );

  const sync = runSync(client, api, rv, logger);
  const result = await sync({ siteId: PLAY_CRICKET_SITE_ID });

  logger.info(
    { matchesProcessed: result.matchesProcessed },
    "play_cricket_sync_complete",
  );

  if (result.errors.length > 0) {
    logger.error(
      { errorCount: result.errors.length, errors: result.errors },
      "play_cricket_sync_completed_with_errors",
    );
  }

  await client.destroy();
  process.exit(result.errors.length > 0 ? 1 : 0);
} catch (error) {
  logger.error({ err: error }, "play_cricket_sync_failed");
  await client.destroy().catch(() => undefined);
  process.exit(1);
}
