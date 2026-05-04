import { type Kysely, sql } from "kysely";

/**
 * Permanence is how long a fact stays useful before it should be
 * re-confirmed:
 *   permanent  — handedness, bowling style, position; never expires.
 *   seasonal   — ground covers/sightscreens, scheduling; revisit yearly.
 *   ephemeral  — weather, recent form, injuries; revisit weekly.
 *
 * NULL = unknown / not yet classified. Auto-retrieval annotates each
 * injected fact with its permanence + age so the debrief flow can decide
 * whether to skip a question that's already answered.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_fact")
    .addColumn("permanence", "text")
    .execute();

  await sql`ALTER TABLE scout_fact
    ADD CONSTRAINT scout_fact_permanence_check
    CHECK (permanence IS NULL OR permanence IN ('permanent','seasonal','ephemeral'))`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_fact")
    .dropConstraint("scout_fact_permanence_check")
    .execute();
  await db.schema.alterTable("scout_fact").dropColumn("permanence").execute();
}
