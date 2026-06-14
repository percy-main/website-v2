import { type Kysely, sql } from "kysely";

/**
 * Grant scout_readonly SELECT on content_item so the AI content-author agent
 * (which reuses Scout's db_run_sql tool over the scout_readonly pool) can
 * resolve real records when emitting person / personGrid / eventPreview
 * blocks - find a person's slug, an event's id/name/when, sibling pages.
 *
 * content_item was created after the scout_readonly role's explicit grant
 * list (migrations 2026-05-03 / 2026-05-07), so it was not covered. The role's
 * GRANTs are the hard security boundary; the SCOUT_ALLOWED_TABLES allowlist in
 * apps/api/src/features/scout/tools/db.ts is defence in depth on top.
 *
 * Note: scout_readonly is shared with the cricket-analyst Scout agent, which
 * therefore also gains read access to content_item. Acceptable - it is
 * read-only and the data is the club's own site content; the content-author
 * system prompt steers it to published rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`GRANT SELECT ON content_item TO scout_readonly`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE SELECT ON content_item FROM scout_readonly`.execute(db);
}
