import { sql, type Kysely } from "kysely";

/**
 * Scout interaction modes — broaden from {scouting, debrief} to
 * {chat, debrief, scout}.
 *
 * - `chat` is the renamed free-form mode (was `scouting`). The UI labels it
 *   "Chat" and it stays the default for new threads.
 * - `scout` is a new focused mode driven by the upcoming-fixtures launcher:
 *   the captain picks one specific match, the agent gathers material and
 *   self-triggers `generate_report`.
 * - `debrief` unchanged.
 *
 * The rename also disambiguates the two-token surface: `scouting` (mode) vs
 * `scout` (other mode) collided in the codebase. After this, `mode === "chat"`
 * and `mode === "scout"` read unambiguously.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_thread")
    .dropConstraint("scout_thread_mode_check")
    .execute();

  await sql`UPDATE scout_thread SET mode = 'chat' WHERE mode = 'scouting'`.execute(
    db,
  );

  await sql`ALTER TABLE scout_thread ALTER COLUMN mode SET DEFAULT 'chat'`.execute(
    db,
  );

  await sql`ALTER TABLE scout_thread
    ADD CONSTRAINT scout_thread_mode_check
    CHECK (mode IN ('chat','debrief','scout'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_thread")
    .dropConstraint("scout_thread_mode_check")
    .execute();

  // Map chat back to scouting. `scout` rows have no equivalent in the old
  // two-value enum — let the re-added CHECK reject them so the down migration
  // fails loud rather than silently dropping data.
  await sql`UPDATE scout_thread SET mode = 'scouting' WHERE mode = 'chat'`.execute(
    db,
  );

  await sql`ALTER TABLE scout_thread ALTER COLUMN mode SET DEFAULT 'scouting'`.execute(
    db,
  );

  await sql`ALTER TABLE scout_thread
    ADD CONSTRAINT scout_thread_mode_check
    CHECK (mode IN ('scouting','debrief'))`.execute(db);
}
