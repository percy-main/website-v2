import { type Kysely, sql } from "kysely";

/**
 * Scout knowledge base — persistent club-wide document store, separate
 * from the scout_fact corpus.
 *
 *   scout_kb_document  — one row per uploaded file (pdf / image / text).
 *                        Drives the admin UI; backs S3 lifecycle.
 *   scout_kb_chunk     — embedding-and-retrieval unit. One document
 *                        produces many chunks. Cosine ANN over voyage-4
 *                        embeddings (dim 1024, same as scout_fact).
 *
 * Re-ingestion deletes + reinserts chunks; there is no supersession
 * concept on chunks (cf. scout_fact). That means indexes are full,
 * not partial. The only cross-table link is the new
 * scout_fact.source_kb_chunk_id pointer — ON DELETE SET NULL so a
 * re-ingest atomically clears stale provenance pointers without
 * cascading the fact rows themselves. If a future caller wraps the
 * chunk DELETE in a SET CONSTRAINTS ... DEFERRED transaction, that
 * atomicity breaks; not a concern in the worker today.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // pgvector is created by the scout_fact migration; the IF NOT EXISTS
  // guard keeps the order of these migrations independent.
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);

  await db.schema
    .createTable("scout_kb_document")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("uploaded_by", "text", (col) =>
      col.references("user.id").onDelete("set null"),
    )
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("filename", "text", (col) => col.notNull())
    .addColumn("content_type", "text", (col) => col.notNull())
    .addColumn("size_bytes", "integer", (col) => col.notNull())
    // pending_key is the uploads-bucket key set at mint, cleared after
    // commit copies bytes to the permanent bucket. s3_key is the
    // permanent-bucket key, set at commit.
    .addColumn("pending_key", "text")
    .addColumn("s3_key", "text")
    // sha256 of the raw bytes, computed at commit. Unique only when
    // populated (partial unique index below) so awaiting-upload rows
    // don't collide on a NULL hash.
    .addColumn("content_hash", "text")
    .addColumn("tags", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("error_message", "text")
    // PDFs only; NULL for images / text.
    .addColumn("page_count", "integer")
    .addColumn("chunk_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "scout_kb_document_kind_check",
      sql`kind IN ('pdf','image','text')`,
    )
    .addCheckConstraint(
      "scout_kb_document_status_check",
      sql`status IN ('awaiting-upload','queued','ingesting','ready','failed')`,
    )
    .execute();

  // Partial unique on hash. Postgres unique indexes already ignore
  // NULLs, but the explicit predicate documents intent and makes the
  // index narrower.
  await sql`CREATE UNIQUE INDEX scout_kb_document_hash_idx
    ON scout_kb_document(content_hash) WHERE content_hash IS NOT NULL`.execute(
    db,
  );

  await sql`CREATE INDEX scout_kb_document_tags_idx
    ON scout_kb_document USING gin (tags)`.execute(db);

  await db.schema
    .createTable("scout_kb_chunk")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("document_id", "uuid", (col) =>
      col.notNull().references("scout_kb_document.id").onDelete("cascade"),
    )
    .addColumn("chunk_index", "integer", (col) => col.notNull())
    // Page range is 1-based and inclusive, matching pdfjs page numbering.
    // For non-PDF documents and for chunks that span no specific page
    // (e.g. caption-as-content for an image) both are NULL.
    .addColumn("page_start", "integer")
    .addColumn("page_end", "integer")
    .addColumn("content", "text", (col) => col.notNull())
    // Chunks inherit document tags by default but can be overridden
    // per chunk (e.g. a section tagged differently from its parent).
    .addColumn("tags", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await sql`ALTER TABLE scout_kb_chunk ADD COLUMN embedding vector(1024) NOT NULL`.execute(
    db,
  );

  // Indexes are full (no partial predicate) — chunks have no
  // supersession concept; re-ingestion deletes and reinserts.
  await sql`CREATE INDEX scout_kb_chunk_embedding_idx
    ON scout_kb_chunk USING hnsw (embedding vector_cosine_ops)`.execute(db);

  await sql`CREATE INDEX scout_kb_chunk_document_idx
    ON scout_kb_chunk(document_id)`.execute(db);

  await sql`CREATE INDEX scout_kb_chunk_tags_idx
    ON scout_kb_chunk USING gin (tags)`.execute(db);

  await sql`CREATE INDEX scout_kb_chunk_content_fts_idx
    ON scout_kb_chunk USING gin (to_tsvector('english', content))`.execute(db);

  // Provenance pointer on facts. NULL when the fact wasn't grounded in
  // a KB chunk. ON DELETE SET NULL so re-ingesting a document doesn't
  // cascade into the fact corpus.
  await db.schema
    .alterTable("scout_fact")
    .addColumn("source_kb_chunk_id", "uuid", (col) =>
      col.references("scout_kb_chunk.id").onDelete("set null"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scout_fact")
    .dropColumn("source_kb_chunk_id")
    .execute();
  await db.schema.dropTable("scout_kb_chunk").execute();
  await db.schema.dropTable("scout_kb_document").execute();
}
