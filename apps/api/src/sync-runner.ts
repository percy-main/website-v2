/**
 * Standalone entry point for Play Cricket sync.
 * Designed to run as a scheduled ECS task — not part of the web server.
 *
 * Environment variables are read directly from process.env
 * (injected by the ECS task definition).
 */

import { createClient } from "@percy-main/db";
import { createApiClient } from "./features/play-cricket/api-client.js";
import { runSync } from "./features/play-cricket/sync.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PLAY_CRICKET_API_TOKEN = process.env.PLAY_CRICKET_API_TOKEN;
const PLAY_CRICKET_SITE_ID = process.env.PLAY_CRICKET_SITE_ID;

if (!DATABASE_URL) throw new Error("Missing required env var: DATABASE_URL");
if (!PLAY_CRICKET_API_TOKEN)
  throw new Error("Missing required env var: PLAY_CRICKET_API_TOKEN");
if (!PLAY_CRICKET_SITE_ID)
  throw new Error("Missing required env var: PLAY_CRICKET_SITE_ID");

const { client, pool } = createClient(DATABASE_URL);
const api = createApiClient({
  apiToken: PLAY_CRICKET_API_TOKEN,
  siteId: PLAY_CRICKET_SITE_ID,
});

try {
  console.log("Starting Play Cricket sync...");

  const sync = runSync(client, api);
  const result = await sync({ siteId: PLAY_CRICKET_SITE_ID });

  console.log(`Sync complete: ${result.matchesProcessed} matches processed`);

  if (result.errors.length > 0) {
    console.error(`Sync completed with ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
  }

  await client.destroy();
  await pool.end();
  process.exit(result.errors.length > 0 ? 1 : 0);
} catch (error) {
  console.error("Sync failed:", error);
  await client.destroy().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
}
