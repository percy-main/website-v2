import { type Kysely, sql } from "kysely";

/**
 * Scout fact RAG corpus. Stores small natural-language facts the agent
 * has learned about clubs, grounds, players and the user, plus their
 * Voyage embeddings for vector retrieval and a tags jsonb for keyword /
 * tag-based retrieval. Hybrid retrieval (vector ∪ tag) feeds Voyage
 * rerank-2.5 to pick the top N facts to inject into each Scout turn.
 *
 * Embedding dim 1024 = voyage-4 default. If we ever switch model we need
 * a follow-up migration: vector(N) is fixed-width.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);

  await db.schema
    .createTable("scout_fact")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // user_id is the *author* of the fact (always present). scope decides
    // who can read it — 'user' = author only, 'club' = everyone with Scout
    // access. Keeps personal preferences ("Alex hates spin") separate from
    // shared knowledge ("Mitford have no covers").
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("scope", "text", (col) => col.notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("tags", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    // Soft-delete via supersession: agents update facts ("Mitford got
    // covers in 2027") rather than deleting old ones, so we keep history.
    // Retrieval filters WHERE superseded_by IS NULL.
    .addColumn("superseded_by", "uuid", (col) =>
      col.references("scout_fact.id").onDelete("set null"),
    )
    // Agent's self-assessed 1–5 confidence at write time. Lets the read
    // path break ties and the admin UI surface low-confidence rows for
    // review.
    .addColumn("confidence", "smallint", (col) => col.notNull().defaultTo(3))
    .addColumn("source_thread_id", "uuid", (col) =>
      col.references("scout_thread.id").onDelete("set null"),
    )
    .addColumn("source_message_id", "uuid", (col) =>
      col.references("scout_message.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint("scout_fact_scope_check", sql`scope IN ('user','club')`)
    .addCheckConstraint(
      "scout_fact_confidence_check",
      sql`confidence BETWEEN 1 AND 5`,
    )
    .execute();

  // vector column added separately because Kysely's schema builder doesn't
  // know the pgvector type. The dimension is the only schema change we'd
  // ever need for a model swap.
  await sql`ALTER TABLE scout_fact ADD COLUMN embedding vector(1024) NOT NULL`.execute(
    db,
  );

  // HNSW for approximate nearest-neighbour. Cosine distance matches what
  // Voyage embeddings are trained on (their docs recommend cosine).
  // m/ef_construction defaults are fine for our scale (low thousands of
  // facts); revisit only if recall starts dropping.
  await sql`CREATE INDEX scout_fact_embedding_idx
    ON scout_fact USING hnsw (embedding vector_cosine_ops)
    WHERE superseded_by IS NULL`.execute(db);

  await sql`CREATE INDEX scout_fact_tags_idx
    ON scout_fact USING gin (tags)
    WHERE superseded_by IS NULL`.execute(db);

  await sql`CREATE INDEX scout_fact_user_scope_idx
    ON scout_fact (user_id, scope)
    WHERE superseded_by IS NULL`.execute(db);

  // Full-text fallback for keyword retrieval — catches exact name matches
  // ("Swalwell") that embedding similarity can drown in semantic noise.
  await sql`CREATE INDEX scout_fact_content_fts_idx
    ON scout_fact USING gin (to_tsvector('english', content))
    WHERE superseded_by IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("scout_fact").execute();
  // Leave the extension in place — other features may add vector columns
  // later, and dropping it is destructive.
}
