import { type Kysely, sql } from "kysely";

// The public game-report endpoint looks content up by the playCricketId
// held in JSONB metadata. Make that lookup deterministic: at most one
// game report per Play-Cricket match, across all statuses (a draft
// duplicate would corrupt the public lookup the moment it published).
// The content service performs an explicit pre-check for a friendly 409;
// this index is the backstop against races.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE UNIQUE INDEX content_item_game_report_play_cricket_id_key
    ON content_item ((metadata->>'playCricketId'))
    WHERE kind = 'game_report'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX content_item_game_report_play_cricket_id_key
  `.execute(db);
}
