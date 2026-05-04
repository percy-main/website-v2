import { type Kysely, sql } from "kysely";

/**
 * Scout interaction modes. `scouting` is the default free-form chat;
 * `debrief` is a guided post-match flow where the agent walks through
 * structured questions (bowler styles, batter weaknesses, ground
 * conditions, our players' uncredited contributions) to grow the fact
 * corpus. Mode is fixed at thread creation — the agent picks system
 * prompt + tool surface from this column.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_thread")
    .addColumn("mode", "text", (col) => col.notNull().defaultTo("scouting"))
    .execute();

  await sql`ALTER TABLE scout_thread
    ADD CONSTRAINT scout_thread_mode_check
    CHECK (mode IN ('scouting','debrief'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_thread")
    .dropConstraint("scout_thread_mode_check")
    .execute();
  await db.schema.alterTable("scout_thread").dropColumn("mode").execute();
}
