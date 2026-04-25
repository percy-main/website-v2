/**
 * Standalone entry point for the marketing retention cleanup job.
 * Designed to run as a nightly ECS scheduled task — not part of the web
 * server. Mirrors `sync-runner.ts`.
 *
 * Usage:
 *   tsx cleanup-runner.ts          # delete eligible rows
 *   tsx cleanup-runner.ts --dry-run  # log counts only, no deletion
 */

import { createClient } from "@percy-main/db";
import { runRetentionCleanup } from "./features/marketing/retention.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("Missing required env var: DATABASE_URL");

const dryRun = process.argv.includes("--dry-run");

const { client } = createClient(DATABASE_URL);

try {
  console.log(
    `Starting marketing retention cleanup${dryRun ? " (dry-run)" : ""}...`,
  );
  const result = await runRetentionCleanup(client)({ dryRun });
  console.log(
    `Cleanup ${dryRun ? "would delete" : "deleted"}: ` +
      `${result.leadsDeleted} unlinked lead(s), ` +
      `${result.outboxRowsDeleted} succeeded outbox row(s)`,
  );
  await client.destroy();
  process.exit(0);
} catch (error) {
  console.error("Cleanup failed:", error);
  await client.destroy().catch(() => undefined);
  process.exit(1);
}
