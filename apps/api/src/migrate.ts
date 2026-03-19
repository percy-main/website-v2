/**
 * Standalone entry point for database migrations.
 * Designed to run as a one-off ECS task — not part of the web server.
 *
 * Environment variables are read directly from process.env
 * (injected by the ECS task definition).
 */

import { createClient } from "@percy-main/db";
import { FileMigrationProvider, Migrator } from "kysely";
import { promises as fs } from "node:fs";
import path from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) throw new Error("Missing required env var: DATABASE_URL");

const { client } = createClient(DATABASE_URL);

const migrator = new Migrator({
  db: client,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(process.cwd(), "packages/db/src/migrations"),
  }),
});

try {
  console.log("Running database migrations...");

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === "Success") {
      console.log(`  ✓ ${it.migrationName}`);
    } else if (it.status === "Error") {
      console.error(`  ✗ ${it.migrationName}`);
    }
  });

  if (error) {
    console.error("Migration failed:", error);
    await client.destroy().catch(noop);
    process.exit(1);
  }

  console.log(`Migrations complete (${results?.length ?? 0} applied)`);
  await client.destroy();
  process.exit(0);
} catch (error) {
  console.error("Migration failed:", error);
  await client.destroy().catch(noop);
  await pool.end().catch(noop);
  process.exit(1);
}

// eslint requires non-empty catch handlers
function noop() {
  // intentionally empty — suppress cleanup errors during shutdown
}
