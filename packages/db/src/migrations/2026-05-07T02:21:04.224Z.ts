import { type Kysely, sql } from "kysely";

/**
 * Fix the match_ball natural key. The original migration claimed ball_no
 * was 1-based per innings, but it's actually 1-based per OVER and resets
 * each over — so the existing UNIQUE
 * (rv_match_id, rv_result_id, innings_number, ball_no) collides on every
 * delivery beyond the first ball of the innings, blocking ingest with
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * Including over_no in the natural key gives us an actual per-delivery
 * unique tuple. match_ball is empty in prod (every BBB ingest has been
 * failing on this since the feature shipped), so a straight DROP/CREATE
 * is safe — no data to migrate.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE match_ball
      DROP CONSTRAINT match_ball_natural_key_uq
  `.execute(db);

  await sql`
    ALTER TABLE match_ball
      ADD CONSTRAINT match_ball_natural_key_uq
      UNIQUE (rv_match_id, rv_result_id, innings_number, over_no, ball_no)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE match_ball
      DROP CONSTRAINT match_ball_natural_key_uq
  `.execute(db);

  await sql`
    ALTER TABLE match_ball
      ADD CONSTRAINT match_ball_natural_key_uq
      UNIQUE (rv_match_id, rv_result_id, innings_number, ball_no)
  `.execute(db);
}
