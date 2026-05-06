import { sql, type Kysely } from "kysely";

/**
 * Collapse the scout_report lifecycle from per-phase tracking
 * (researching → analysing → rendering) to a single generating state, now
 * that the report pipeline is one agent loop rather than three sequenced
 * phases. Drops the `phases` JSONB column which used to persist per-phase
 * timing + recent tool-call chips for the FE pipeline-card.
 *
 * Steps:
 *  1. Migrate any in-flight rows in the old statuses to 'failed' so the
 *     constraint swap below doesn't reject them. These are dev-only stale
 *     rows; production has no in-flight reports during the deploy window.
 *  2. Replace the status CHECK constraint with the new value set
 *     (queued | generating | rendering | ready | failed).
 *  3. Drop the unused `phases` JSONB column.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE scout_report
    SET status = 'failed',
        error_message = COALESCE(error_message, 'Migrated from removed phase status during pipeline unification.')
    WHERE status IN ('researching', 'analysing', 'rendering')`.execute(db);

  await sql`ALTER TABLE scout_report DROP CONSTRAINT scout_report_status_check`.execute(
    db,
  );
  await sql`ALTER TABLE scout_report ADD CONSTRAINT scout_report_status_check
    CHECK (status IN ('queued', 'generating', 'rendering', 'ready', 'failed'))`.execute(
    db,
  );

  await sql`ALTER TABLE scout_report DROP COLUMN phases`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE scout_report ADD COLUMN phases JSONB`.execute(db);

  await sql`ALTER TABLE scout_report DROP CONSTRAINT scout_report_status_check`.execute(
    db,
  );
  await sql`ALTER TABLE scout_report ADD CONSTRAINT scout_report_status_check
    CHECK (status IN ('queued', 'researching', 'analysing', 'rendering', 'ready', 'failed'))`.execute(
    db,
  );

  // Up moved 'researching'/'analysing'/'rendering' rows to 'failed' with a
  // marker error_message; we deliberately do NOT try to reverse that — those
  // rows had no useful state to recover and the dev test bench is the only
  // place this matters.
}
