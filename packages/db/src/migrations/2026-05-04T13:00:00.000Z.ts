import { type Kysely, sql } from "kysely";

/**
 * Convert match_date columns from DD/MM/YYYY (raw Play Cricket format) to
 * ISO YYYY-MM-DD across the tables hydrated by play-cricket sync. Lex
 * ordering on the old format is wrong ("31/08/2013" > "07/06/2025"), and
 * any consumer comparing against `new Date().toISOString().slice(0,10)`
 * silently filtered everything out.
 *
 * `matchday`, `availability_fixture`, `availability_response` already store
 * ISO (their writers convert) and are intentionally left alone.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const tables = [
    "match_result",
    "match_performance_batting",
    "match_performance_bowling",
    "match_performance_fielding",
    "play_cricket_match_cache",
  ] as const;

  for (const table of tables) {
    await sql`
      UPDATE ${sql.raw(table)}
      SET match_date =
        substring(match_date FROM 7 FOR 4) || '-' ||
        substring(match_date FROM 4 FOR 2) || '-' ||
        substring(match_date FROM 1 FOR 2)
      WHERE match_date ~ '^\\d{2}/\\d{2}/\\d{4}$'
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const tables = [
    "match_result",
    "match_performance_batting",
    "match_performance_bowling",
    "match_performance_fielding",
    "play_cricket_match_cache",
  ] as const;

  for (const table of tables) {
    await sql`
      UPDATE ${sql.raw(table)}
      SET match_date =
        substring(match_date FROM 9 FOR 2) || '/' ||
        substring(match_date FROM 6 FOR 2) || '/' ||
        substring(match_date FROM 1 FOR 4)
      WHERE match_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
    `.execute(db);
  }
}
