import { type Kysely, sql } from "kysely";

// Adds Women's Softball (Play Cricket "Pairs" game_type) support to the
// performance tables and match_result. Pairs games differ from hardball in two
// ways the data model previously couldn't represent:
//   1. A single batter can be dismissed more than once per innings (times_out),
//      and innings.wickets = sum of per-batter times_out.
//   2. Net runs are computed against a starting score with a per-dismissal
//      penalty: net_score = starting_runs + runs - wickets * dismissal_penalty.
// Storing the format + scoring constants on every performance row lets the
// unified average formula
//   (SUM(runs) - SUM(times_out * dismissal_penalty)) / NULLIF(SUM(times_out),0)
// collapse to the standard hardball average when dismissal_penalty = 0.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("match_performance_batting")
    .addColumn("times_out", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("dismissal_penalty", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("game_type", "text", (col) =>
      col.notNull().defaultTo("Standard"),
    )
    .execute();

  // Backfill: existing rows are all hardball. Each dismissed batter counts as
  // exactly one wicket; not-outs as zero.
  await sql`
    UPDATE match_performance_batting
    SET times_out = CASE WHEN not_out THEN 0 ELSE 1 END
    WHERE times_out = 0 AND not_out = false
  `.execute(db);

  await db.schema
    .alterTable("match_performance_bowling")
    .addColumn("game_type", "text", (col) =>
      col.notNull().defaultTo("Standard"),
    )
    .execute();

  await db.schema
    .alterTable("match_performance_fielding")
    .addColumn("game_type", "text", (col) =>
      col.notNull().defaultTo("Standard"),
    )
    .execute();

  await db.schema
    .alterTable("match_result")
    .addColumn("game_type", "text", (col) =>
      col.notNull().defaultTo("Standard"),
    )
    .addColumn("starting_runs", "integer")
    .addColumn("dismissal_penalty", "integer")
    .execute();

  // Index supports "career stats partitioned by format" queries on the
  // player profile and records pages.
  await db.schema
    .createIndex("idx_batting_player_game_type")
    .on("match_performance_batting")
    .columns(["player_id", "game_type"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("idx_batting_player_game_type")
    .ifExists()
    .execute();

  await db.schema
    .alterTable("match_result")
    .dropColumn("game_type")
    .dropColumn("starting_runs")
    .dropColumn("dismissal_penalty")
    .execute();

  await db.schema
    .alterTable("match_performance_fielding")
    .dropColumn("game_type")
    .execute();

  await db.schema
    .alterTable("match_performance_bowling")
    .dropColumn("game_type")
    .execute();

  await db.schema
    .alterTable("match_performance_batting")
    .dropColumn("times_out")
    .dropColumn("dismissal_penalty")
    .dropColumn("game_type")
    .execute();
}
