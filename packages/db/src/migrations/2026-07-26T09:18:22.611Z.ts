import { type Kysely, sql } from "kysely";

// Data fix for the how_out format mismatch in the Play Cricket sync.
//
// Play Cricket sends how_out as full text ("not out", "did not bat",
// "retired not out") but the sync only recognised abbreviations ("no",
// "dnb", "rtno"), so every hardball innings - including genuine not-outs
// and players who never batted - was stored with times_out = 1 and
// not_out = false. Effects: leaderboards showed zero not-outs, averages
// divided by innings instead of dismissals, and "did not bat" rows
// counted as an innings plus a dismissal each.
//
// "Did not bat" rows stay in the table: they are the appearance record
// (fantasy team win bonus, career-matches record - a player in the XI who
// never took strike still played the match). The new did_bat flag lets
// innings/not-out aggregations exclude them without string-matching
// how_out everywhere.
//
// how_out is stored verbatim on every row, so the bad rows can be repaired
// in place - no resync needed (the sync only revisits the last 7 days
// anyway). Rows with how_out = 'pairs inning' (32 rows, 2013 junior pairs
// games) are left untouched: that label carries no dismissal information.
//
// The not-out repair is scoped to game_type = 'Standard': Pairs rows take
// times_out from the API's per-batter field, which was always correct.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("match_performance_batting")
    .addColumn("did_bat", "boolean", (col) => col.notNull().defaultTo(true))
    .execute();

  // Appearances, not innings: no dismissal, and not_out = false because
  // there was no innings to be not out in.
  await sql`
    UPDATE match_performance_batting
    SET did_bat = false, times_out = 0, not_out = false
    WHERE LOWER(TRIM(how_out)) IN ('did not bat', 'dnb', 'absent')
  `.execute(db);

  // Repair not-out innings wrongly recorded as dismissals.
  await sql`
    UPDATE match_performance_batting
    SET times_out = 0, not_out = true
    WHERE game_type = 'Standard'
      AND LOWER(TRIM(how_out)) IN
        ('no', 'not out', 'rtd', 'retired', 'retired hurt', 'rtno', 'retired not out')
      AND times_out <> 0
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // The times_out/not_out repair is an irreversible data fix; only the
  // added column is dropped.
  await db.schema
    .alterTable("match_performance_batting")
    .dropColumn("did_bat")
    .execute();
}
