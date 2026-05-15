/**
 * Standalone entry point for database migrations.
 * Designed to run as a one-off ECS task — not part of the web server.
 *
 * Environment variables are read directly from process.env
 * (injected by the ECS task definition).
 */

import type { DB } from "@percy-main/db";
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
} from "kysely";
import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import { createWorkerLogger } from "./lib/worker-logger.ts";

const logger = createWorkerLogger("migrate");

// The migration runner connects as a DDL-privileged role (app_ddl), not
// the runtime CRUD role (app_rw). Prefer DATABASE_MIGRATION_URL if set;
// fall back to DATABASE_URL for environments that haven't split yet
// (local dev with the percy superuser, single-URL CI). See ADR on
// principle-of-least-privilege DB roles for the split rationale.
const DATABASE_URL =
  process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "Missing required env var: set DATABASE_MIGRATION_URL or DATABASE_URL",
  );
}

// Bound the time we'll wait for an ACCESS EXCLUSIVE lock and the time
// any single statement can run. Without these, a migration that races
// with a long-running query can hang the deploy until ECS task-stopped
// (~10 min default) or the workflow timeout — masking what would have
// been an immediate, clear failure. libpq's `options` is applied at
// connect time so every checkout already has them set, with no race
// between the connection becoming available and a SET on it landing.
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 10,
  options: "-c lock_timeout=5000 -c statement_timeout=60000",
});
const client = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

const migrator = new Migrator({
  db: client,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(process.cwd(), "packages/db/src/migrations"),
  }),
});

try {
  logger.info("migrate_started");

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === "Success") {
      logger.info({ migrationName: it.migrationName }, "migrate_step_success");
    } else if (it.status === "Error") {
      logger.error({ migrationName: it.migrationName }, "migrate_step_failed");
    }
  });

  if (error) {
    logger.error({ err: error }, "migrate_failed");
    await client.destroy().catch(noop);
    process.exit(1);
  }

  logger.info({ count: results?.length ?? 0 }, "migrate_complete");
  await client.destroy();
  process.exit(0);
} catch (error) {
  logger.error({ err: error }, "migrate_failed");
  await client.destroy().catch(noop);
  process.exit(1);
}

// eslint requires non-empty catch handlers
function noop() {
  // intentionally empty — suppress cleanup errors during shutdown
}
