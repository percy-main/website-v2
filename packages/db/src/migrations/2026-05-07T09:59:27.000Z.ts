import type { Kysely } from "kysely";

/**
 * Persist club_id / club_name on match_result so consumers can identify
 * which side was Percy Main.
 *
 * Play Cricket's match-detail API returns team names bare ("1st XI",
 * "2nd XI") with no club prefix — for both home and away. The only
 * disambiguator is the club_id, which sync already has on hand
 * (match.home_club_id / match.away_club_id from the summary endpoint
 * and detail.{home,away}_club_id in the detail endpoint) but never
 * stored. Without it, listRecentDebriefMatches can't tell which row
 * is "ours" except by string-matching team names — which fails because
 * PC stores them un-prefixed.
 *
 * Columns are nullable: existing rows stay NULL forever (sync does not
 * backfill historic matches outside the resync window). Going forward,
 * every newly-written or upserted match_result row carries the four
 * fields. The launcher's 14-day window means the NULL legacy rows
 * naturally fall out of view within two weeks.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("match_result")
    .addColumn("home_club_id", "text")
    .addColumn("home_club_name", "text")
    .addColumn("away_club_id", "text")
    .addColumn("away_club_name", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("match_result")
    .dropColumn("home_club_id")
    .dropColumn("home_club_name")
    .dropColumn("away_club_id")
    .dropColumn("away_club_name")
    .execute();
}
