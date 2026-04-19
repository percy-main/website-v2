import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE matchday_social_publication (
      id TEXT PRIMARY KEY,
      matchday_id TEXT NOT NULL REFERENCES matchday(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
      state TEXT NOT NULL CHECK (state IN ('claimed', 'posted', 'failed')),
      claim_token TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      posted_at TEXT,
      external_post_id TEXT,
      caption TEXT NOT NULL,
      caption_source TEXT NOT NULL CHECK (caption_source IN ('ai', 'fallback')),
      caption_prompt_version TEXT NOT NULL,
      image_url TEXT NOT NULL,
      last_error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT matchday_social_publication_unique UNIQUE (matchday_id, platform),

      CONSTRAINT matchday_social_publication_posted_complete CHECK (
        (state <> 'posted') OR
        (external_post_id IS NOT NULL AND posted_at IS NOT NULL)
      ),

      CONSTRAINT matchday_social_publication_external_id_immutable CHECK (
        external_post_id IS NULL OR state = 'posted'
      )
    )
  `.execute(db);

  await sql`
    CREATE INDEX matchday_social_publication_matchday_idx
      ON matchday_social_publication (matchday_id)
  `.execute(db);

  await sql`
    CREATE INDEX matchday_social_publication_state_idx
      ON matchday_social_publication (state)
      WHERE state IN ('claimed', 'failed')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE matchday_social_publication`.execute(db);
}
