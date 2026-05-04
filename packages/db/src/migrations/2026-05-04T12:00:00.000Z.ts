import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── scout_report: AI-generated PDF reports stored in S3 ──
  // One row per generated report. The PDF lives in the scout-reports
  // S3 bucket; we store only the s3_key + metadata. Cascades from the
  // owning thread so deleting a thread cleans up its reports (the
  // bucket lifecycle rule will sweep the orphaned objects).
  await db.schema
    .createTable("scout_report")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("thread_id", "uuid", (col) =>
      col.notNull().references("scout_thread.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (col) =>
      col.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("s3_key", "text", (col) => col.notNull())
    .addColumn("file_size_bytes", "integer")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await sql`CREATE INDEX scout_report_user_created_idx ON scout_report (user_id, created_at DESC)`.execute(
    db,
  );

  await db.schema
    .createIndex("scout_report_thread_idx")
    .on("scout_report")
    .column("thread_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("scout_report").execute();
}
