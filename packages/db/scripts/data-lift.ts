/**
 * Data Lift — migrate data from v1 SQLite/Turso to v2 PostgreSQL.
 *
 * Usage:
 *   pnpm run db:lift --source file:local.db
 *   pnpm run db:lift --source libsql://your-db.turso.io --token xxx
 *   pnpm run db:lift --target postgres://percy:percy@localhost:5433/percy_main
 *
 * Defaults:
 *   --target  postgres://percy:percy@localhost:5433/percy_main
 */

import { createClient as createLibsqlClient } from "@libsql/client";
import pg from "pg";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") continue;
    if (args[i].startsWith("--") && i + 1 < args.length) {
      parsed[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

const args = parseArgs();

if (!args.source) {
  console.error(
    "Usage: tsx data-lift.ts --source <file:path|libsql://url> [--token <turso-token>] [--target <pg-url>]",
  );
  process.exit(1);
}

const sourceUrl = args.source;
const authToken = args.token;
const targetUrl =
  args.target ?? "postgres://percy:percy@localhost:5433/percy_main";

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const sqlite = createLibsqlClient({
  url: sourceUrl,
  ...(authToken ? { authToken } : {}),
});

const pool = new pg.Pool({ connectionString: targetUrl, max: 5 });

// ---------------------------------------------------------------------------
// Type conversions: SQLite INTEGER (0/1) → PG BOOLEAN
// ---------------------------------------------------------------------------

const BOOLEAN_COLUMNS: Record<string, Set<string>> = {
  user: new Set(["emailVerified", "twoFactorEnabled", "banned"]),
  passkey: new Set(["backedUp"]),
  dependent: new Set([
    "played_before",
    "whatsapp_consent",
    "alt_contact_whatsapp_consent",
    "has_disability",
    "emergency_medical_consent",
    "medical_fitness_declaration",
    "data_protection_consent",
    "photo_consent",
  ]),
  play_cricket_team: new Set(["is_junior"]),
  match_performance_batting: new Set(["not_out"]),
  match_performance_fielding: new Set(["is_wicketkeeper"]),
  game_sponsorship: new Set(["approved"]),
  player_sponsorship: new Set(["approved"]),
  fantasy_player: new Set(["eligible"]),
  fantasy_team_player: new Set(["is_captain", "is_wicketkeeper"]),
  fantasy_player_score: new Set(["is_actual_keeper"]),
  fantasy_chaos_week: new Set(["send_email", "email_sent"]),
};

// Columns that are JSONB in PG but TEXT in SQLite
const JSONB_COLUMNS: Record<string, Set<string>> = {
  event_subscriber: new Set(["meta"]),
};

// Tables with SERIAL PKs — need sequence reset after insert
const SERIAL_TABLES = [
  "fantasy_team",
  "fantasy_team_player",
  "fantasy_player_score",
  "fantasy_team_score",
  "fantasy_chip_usage",
  "fantasy_chaos_week",
];

// ---------------------------------------------------------------------------
// Table insertion order (respects foreign keys)
// ---------------------------------------------------------------------------

const TABLE_ORDER = [
  // Auth (no deps)
  "user",
  "session",
  "account",
  "verification",
  "passkey",
  "twoFactor",

  // Core entities
  "member",
  "play_cricket_team",
  "junior_team",

  // Entities with user/member FKs
  "dependent",
  "membership",
  "charge",
  "charge_dependent",

  // Team management
  "team_official",
  "junior_team_manager",

  // Matchday (depends on play_cricket_team, user, member, charge)
  "matchday",
  "matchday_player",
  "match_fee_rate",
  "matchday_expense",

  // Cricket performance data
  "play_cricket_sync_log",
  "play_cricket_match_cache",
  "match_result",
  "match_performance_batting",
  "match_performance_bowling",
  "match_performance_fielding",

  // Sponsorships
  "game_sponsorship",
  "player_sponsorship",

  // Fantasy
  "fantasy_player",
  "fantasy_team",
  "fantasy_team_player",
  "fantasy_player_score",
  "fantasy_team_score",
  "fantasy_chip_usage",
  "fantasy_chaos_week",

  // Community
  "game_score",
  "event_subscriber",
  "contact_submission",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertRow(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const boolCols = BOOLEAN_COLUMNS[table];
  const jsonbCols = JSONB_COLUMNS[table];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    let converted = value;

    // SQLite INTEGER 0/1 → PG boolean
    if (boolCols?.has(key)) {
      converted =
        value === null || value === undefined
          ? null
          : value === 1 || value === true;
    }

    // SQLite TEXT JSON → PG jsonb (needs to be a valid JSON string for pg)
    if (jsonbCols?.has(key) && typeof converted === "string") {
      try {
        JSON.parse(converted);
      } catch {
        throw new Error(
          `Invalid JSON in ${table}.${key}: ${String(converted).slice(0, 100)}`,
        );
      }
    }

    result[key] = converted;
  }

  return result;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function insertBatch(
  client: pg.PoolClient,
  table: string,
  rows: Record<string, unknown>[],
) {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  const quotedCols = columns.map(quoteIdent).join(", ");

  // Build parameterised VALUES for each row
  const valueClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const row of rows) {
    const placeholders = columns.map(() => `$${paramIdx++}`);
    valueClauses.push(`(${placeholders.join(", ")})`);
    for (const col of columns) {
      params.push(row[col] ?? null);
    }
  }

  const sql = `INSERT INTO ${quoteIdent(table)} (${quotedCols}) VALUES ${valueClauses.join(", ")} ON CONFLICT DO NOTHING`;
  await client.query(sql, params);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nData Lift: SQLite → PostgreSQL`);
  console.log(`  Source: ${sourceUrl}`);
  console.log(`  Target: ${targetUrl}\n`);

  const client = await pool.connect();

  try {
    const stats: { table: string; rows: number }[] = [];

    for (const table of TABLE_ORDER) {
      // Read from SQLite
      const result = await sqlite.execute(`SELECT * FROM "${table}"`);

      if (result.rows.length === 0) {
        stats.push({ table, rows: 0 });
        continue;
      }

      // Convert rows
      const rows = result.rows.map((row) =>
        convertRow(table, row as Record<string, unknown>),
      );

      // Insert in batches of 500 (PG param limit is 65535)
      const BATCH_SIZE = 500;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await insertBatch(client, table, batch);
      }

      stats.push({ table, rows: rows.length });
      console.log(
        `  ✓ ${table}: ${rows.length} row${rows.length !== 1 ? "s" : ""}`,
      );
    }

    // Reset sequences for SERIAL tables
    for (const table of SERIAL_TABLES) {
      const seqName = `${table}_id_seq`;
      const maxResult = await client.query(
        `SELECT COALESCE(MAX(id), 0) AS max_id FROM ${quoteIdent(table)}`,
      );
      const maxId = Number(maxResult.rows[0].max_id);
      if (maxId > 0) {
        await client.query(`SELECT setval($1, $2)`, [seqName, maxId]);
        console.log(`  ↻ ${seqName} → ${maxId}`);
      }
    }

    // Summary
    const totalRows = stats.reduce((sum, s) => sum + s.rows, 0);
    const nonEmpty = stats.filter((s) => s.rows > 0).length;
    console.log(
      `\nDone: ${totalRows} rows across ${nonEmpty} tables (${stats.length} total)\n`,
    );
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error("\nData lift failed:", err);
  process.exit(1);
});
