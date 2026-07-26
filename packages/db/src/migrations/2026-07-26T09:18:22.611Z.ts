import { type Kysely, sql } from "kysely";

// Data fix for the how_out format mismatch in the Play Cricket sync.
//
// Play Cricket sends how_out as full text ("not out", "did not bat",
// "retired not out") but the sync only recognised abbreviations ("no",
// "dnb", "rtno"), so every hardball innings - including genuine not-outs
// and players who never batted - was stored with times_out = 1 and
// not_out = false. Effects: leaderboards showed zero not-outs, averages
// divided by innings instead of dismissals, and "did not bat" rows
// inflated innings + dismissal counts.
//
// how_out is stored verbatim on every row, so the bad rows can be repaired
// in place - no resync needed (the sync only revisits the last 7 days
// anyway). Rows with how_out = 'pairs inning' (32 rows, 2013 junior pairs
// games) are left untouched: that label carries no dismissal information.
//
// The UPDATE is scoped to game_type = 'Standard': Pairs rows take
// times_out from the API's per-batter field, which was always correct.

export async function up(db: Kysely<unknown>): Promise<void> {
  // Players listed on the scorecard who never took strike are not innings.
  // The fixed sync no longer inserts these.
  await sql`
    DELETE FROM match_performance_batting
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

export async function down(): Promise<void> {
  // Irreversible data fix: the deleted "did not bat" rows and the corrupted
  // times_out/not_out values are not worth reconstructing. A full resync
  // from Play Cricket would rebuild the table if ever needed.
}
