import { type Kysely, sql } from "kysely";

/**
 * Grant scout_readonly SELECT on content_item so the AI content-author agent
 * (which reuses Scout's db_run_sql tool over the scout_readonly pool) can
 * resolve real records when emitting person / personGrid / eventPreview
 * blocks - find a person's slug, an event's id/name/when, sibling pages.
 *
 * content_item was created after the scout_readonly role's explicit grant
 * list (migrations 2026-05-03 / 2026-05-07), so it was not covered. The role's
 * GRANTs are the security boundary; the SCOUT_ALLOWED_TABLES allowlist in
 * apps/api/src/features/scout/tools/db.ts is defence in depth on top.
 *
 * scout_readonly is the shared read-only role for all AI agents (Scout +
 * content author). Its tables are intentionally curated to be safe for AI /
 * LLM access on this single-tenant, trusted-user deployment, so the content
 * author sharing that surface (now including content_item) is by design.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`GRANT SELECT ON content_item TO scout_readonly`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE SELECT ON content_item FROM scout_readonly`.execute(db);
}
