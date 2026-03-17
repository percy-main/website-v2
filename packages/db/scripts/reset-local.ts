/**
 * Reset local PostgreSQL database — drops all tables and re-runs migrations.
 *
 * Usage: pnpm run db:reset
 *
 * Only works against the local Docker instance (port 5433) by default.
 */

import "dotenv/config";
import { promises as fs } from "fs";
import { FileMigrationProvider, Migrator } from "kysely";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { createClient } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://percy:percy@localhost:5433/percy_main";

// Safety: refuse to run against anything that doesn't look local
const parsed = new URL(connectionString);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
if (!LOCAL_HOSTS.has(parsed.hostname)) {
  console.error(
    `Refusing to reset non-local database (hostname: ${parsed.hostname}). Aborting.`,
  );
  process.exit(1);
}

console.log(`\nResetting database: ${connectionString}\n`);

// Step 1: Drop all tables using a raw connection
const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();

try {
  // Get all table names in the public schema
  const result = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);

  const tables = result.rows.map((r) => r.tablename);

  if (tables.length > 0) {
    // CASCADE drops dependent objects (indexes, constraints, etc.)
    const dropSql = tables
      .map((t) => `"${t}"`)
      .join(", ");
    await client.query(`DROP TABLE IF EXISTS ${dropSql} CASCADE`);
    console.log(`  ✓ Dropped ${tables.length} tables`);
  } else {
    console.log("  (no tables to drop)");
  }
} finally {
  client.release();
  await pool.end();
}

// Step 2: Re-run migrations
const { client: kyselyClient } = createClient(connectionString);

const migrator = new Migrator({
  db: kyselyClient,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(__dirname, "../src/migrations"),
  }),
});

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
  process.exit(1);
}

console.log(`\nReset complete (${results?.length ?? 0} migrations applied)\n`);
await kyselyClient.destroy();
