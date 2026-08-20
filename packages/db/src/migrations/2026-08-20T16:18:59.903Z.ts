import { type Kysely } from "kysely";

/**
 * Custom (non-Play-Cricket) fixtures: matchdays created without a
 * play_cricket_match_id have no upstream record to derive home/away or
 * start time from, so captains supply them at creation. Nullable - PC
 * matchdays keep deriving both from the matches-summary lookup.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("matchday")
    .addColumn("is_home", "boolean")
    .execute();

  await db.schema
    .alterTable("matchday")
    .addColumn("match_time", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("matchday").dropColumn("is_home").execute();
  await db.schema.alterTable("matchday").dropColumn("match_time").execute();
}
