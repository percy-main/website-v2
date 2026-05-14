import type { Kysely } from "kysely";

/**
 * Let captains pick a junior (dependent) for a matchday squad even
 * when that junior has no `member` row of their own.
 *
 * `matchday_player.member_id` already supports senior players (and
 * juniors who happen to have their own account). `dependent_id` is
 * the new alternative target — a captain picks a child registered by
 * a parent, and the row points at `dependent` directly.
 *
 * No CHECK constraint between member_id / dependent_id: the ad-hoc
 * guest path still creates a guest member, so member_id stays
 * populated for those. Treat the columns as "at most one is set" by
 * convention enforced in the service.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("matchday_player")
    .addColumn("dependent_id", "text", (col) => col.references("dependent.id"))
    .execute();

  await db.schema
    .createIndex("idx_matchday_player_dependent")
    .on("matchday_player")
    .column("dependent_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("idx_matchday_player_dependent")
    .ifExists()
    .execute();

  await db.schema
    .alterTable("matchday_player")
    .dropColumn("dependent_id")
    .execute();
}
