import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── member_public view: the single redaction boundary for the MCP
  // surface's view of members. Deliberately narrower than Scout's
  // scout_member view (which includes dob) — MCP is usable by any
  // signed-up member, not just an admin-vetted audience, so only id and
  // name are exposed. See ADR 062.
  await sql`
    CREATE VIEW member_public AS
    SELECT id, name
    FROM member
    WHERE deleted_at IS NULL
  `.execute(db);

  // ── mcp_readonly role ──
  // NOLOGIN: password and LOGIN attribute are set out-of-band per
  // environment (Terraform/Secrets Manager in prod, dev setup script
  // locally) so credentials never enter the migration history.
  await sql`CREATE ROLE mcp_readonly NOLOGIN`.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO mcp_readonly`.execute(db);
  await sql`GRANT SELECT ON
    matchday,
    matchday_player,
    match_result,
    match_performance_batting,
    match_performance_bowling,
    match_performance_fielding,
    play_cricket_match_cache,
    play_cricket_team,
    match_ball,
    match_stream,
    rv_player_mapping,
    content_item,
    member_public
  TO mcp_readonly`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL ON
    matchday, matchday_player, match_result,
    match_performance_batting, match_performance_bowling, match_performance_fielding,
    play_cricket_match_cache, play_cricket_team,
    match_ball, match_stream, rv_player_mapping,
    content_item, member_public
  FROM mcp_readonly`.execute(db);
  await sql`REVOKE USAGE ON SCHEMA public FROM mcp_readonly`.execute(db);
  await sql`DROP ROLE mcp_readonly`.execute(db);
  await sql`DROP VIEW member_public`.execute(db);
}
