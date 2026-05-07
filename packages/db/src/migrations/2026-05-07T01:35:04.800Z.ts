import { type Kysely, sql } from "kysely";

/**
 * Extend the scout_readonly role's SELECT grants to cover the BBB tables
 * landed in 2026-05-07T00:35:34.071Z so the upcoming ask_ball_by_ball
 * sub-agent can read them.
 *
 * Both Scout sub-agents (ask_db + ask_ball_by_ball) share this same
 * role; the per-sub-agent allowlists in
 * apps/api/src/features/scout/tools/db.ts + ask-ball-by-ball.ts gate
 * schema discovery and table-name masking, NOT the SQL itself. db_run_sql
 * executes any SELECT the role can perform — so in principle ask_db
 * could SELECT from match_ball if the model typed it in. We accept this
 * soft boundary because (a) the user is trusted, single-tenant, and
 * (b) all rows in question are Percy Main's own data. The role's
 * GRANTs remain the hard limit.
 *
 * If a per-sub-agent data boundary is ever needed (multi-tenant Scout,
 * untrusted input), provision a second readonly role with a narrower
 * grant set and inject a different Kysely client per sub-agent.
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
