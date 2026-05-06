import { type Kysely, sql } from "kysely";

/**
 * Track 1 — Scout chat attachments (ephemeral).
 *
 *  - scout_attachment: per-thread record of an upload. Lifetime tracks the
 *    thread via ON DELETE CASCADE. Bytes live in the permanent attachments
 *    S3 bucket once committed; pending bytes live in the uploads bucket
 *    (24h S3 lifecycle).
 *  - scout_attachment_cache: content-addressed cache of derived text keyed
 *    on the SHA-256 of the file bytes. Survives row deletion so re-uploads
 *    of the same image / PDF skip the Haiku call.
 *  - scout_message.attachment_ids: nullable UUID[] of attachments the user
 *    pinned to a particular turn. Kept as a column rather than mixed into
 *    `parts`, which is set verbatim from AI SDK UIMessage parts and must
 *    stay clean for replay.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("scout_attachment")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("thread_id", "uuid", (col) =>
      col.notNull().references("scout_thread.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("content_type", "text", (col) => col.notNull())
    .addColumn("size_bytes", "integer", (col) => col.notNull())
    .addColumn("filename", "text", (col) => col.notNull())
    .addColumn("pending_key", "text")
    .addColumn("s3_key", "text")
    .addColumn("content_hash", "text")
    .addColumn("derived_text", "text")
    .addColumn("processing_state", "text", (col) => col.notNull())
    .addColumn("processing_error", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "scout_attachment_kind_check",
      sql`kind IN ('image','pdf')`,
    )
    .addCheckConstraint(
      "scout_attachment_state_check",
      sql`processing_state IN ('awaiting-upload','processing','ready','failed')`,
    )
    .execute();

  await db.schema
    .createIndex("scout_attachment_thread_idx")
    .on("scout_attachment")
    .column("thread_id")
    .execute();

  await db.schema
    .createIndex("scout_attachment_hash_idx")
    .on("scout_attachment")
    .column("content_hash")
    .execute();

  await db.schema
    .createTable("scout_attachment_cache")
    .addColumn("content_hash", "text", (col) => col.primaryKey())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("derived_text", "text", (col) => col.notNull())
    .addColumn("source", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "scout_attachment_cache_kind_check",
      sql`kind IN ('image','pdf')`,
    )
    .execute();

  await sql`ALTER TABLE scout_message ADD COLUMN attachment_ids UUID[]`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE scout_message DROP COLUMN attachment_ids`.execute(db);
  await db.schema.dropTable("scout_attachment_cache").execute();
  await db.schema.dropTable("scout_attachment").execute();
}
