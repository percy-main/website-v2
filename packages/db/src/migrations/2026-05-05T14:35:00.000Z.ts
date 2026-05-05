import { sql, type Kysely } from "kysely";

/**
 * scout_report: extend to be the source of truth for in-flight runs as well as
 * completed reports. Adds lifecycle columns (status, error_message, phases JSONB,
 * started_at, cancel_requested) and the match scope columns the worker needs to
 * pick up a queued row (match_id, our_team, opposition, match_date, home_away,
 * competition, intent).
 *
 * s3_key drops NOT NULL — queued/in-flight rows have no PDF yet. Existing rows
 * are all completed reports, so they pick up status='ready' from the default.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE scout_report ALTER COLUMN s3_key DROP NOT NULL`.execute(
    db,
  );

  await sql`ALTER TABLE scout_report
    ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'
      CHECK (status IN ('queued', 'researching', 'analysing', 'rendering', 'ready', 'failed')),
    ADD COLUMN error_message TEXT,
    ADD COLUMN phases JSONB,
    ADD COLUMN started_at TIMESTAMPTZ,
    ADD COLUMN cancel_requested BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN match_id TEXT,
    ADD COLUMN our_team TEXT,
    ADD COLUMN opposition TEXT,
    ADD COLUMN match_date TEXT,
    ADD COLUMN home_away TEXT
      CHECK (home_away IS NULL OR home_away IN ('home', 'away')),
    ADD COLUMN competition TEXT,
    ADD COLUMN intent TEXT`.execute(db);

  // Index drives the concurrency gate (count of in-flight rows) and the
  // Reports tab's in-flight listing. Partial index on the small live set keeps
  // it cheap even as completed-report volume grows.
  await sql`CREATE INDEX scout_report_inflight_idx
    ON scout_report (status)
    WHERE status NOT IN ('ready', 'failed')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS scout_report_inflight_idx`.execute(db);

  await sql`ALTER TABLE scout_report
    DROP COLUMN intent,
    DROP COLUMN competition,
    DROP COLUMN home_away,
    DROP COLUMN match_date,
    DROP COLUMN opposition,
    DROP COLUMN our_team,
    DROP COLUMN match_id,
    DROP COLUMN cancel_requested,
    DROP COLUMN started_at,
    DROP COLUMN phases,
    DROP COLUMN error_message,
    DROP COLUMN status`.execute(db);

  // Re-asserting NOT NULL after the down would fail on any in-flight row that
  // outlived the down. Down migrations are dev-only here (CI applies up only),
  // so it's acceptable to require operator cleanup before re-running down.
  await sql`ALTER TABLE scout_report ALTER COLUMN s3_key SET NOT NULL`.execute(
    db,
  );
}
