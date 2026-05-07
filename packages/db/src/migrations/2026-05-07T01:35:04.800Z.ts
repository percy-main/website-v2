import { type Kysely, sql } from "kysely";

/**
 * Extend the scout_readonly role's SELECT grants to cover the BBB tables
 * landed in 2026-05-07T00:35:34.071Z. The existing ask_db sub-agent does
 * NOT receive these (kept off SCOUT_ALLOWED_TABLES); a parallel
 * ask_ball_by_ball sub-agent will.
 *
 * Code-side allowlists in apps/api/src/features/scout/tools/db.ts +
 * ask-db.ts / ask-ball-by-ball.ts give defence-in-depth + nicer
 * db_list_tables output, but this GRANT is the actual security boundary.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    GRANT SELECT ON
      match_ball,
      match_stream,
      rv_player_mapping
    TO scout_readonly
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    REVOKE SELECT ON
      match_ball,
      match_stream,
      rv_player_mapping
    FROM scout_readonly
  `.execute(db);
}
