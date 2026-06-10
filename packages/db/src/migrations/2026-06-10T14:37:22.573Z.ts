import { type Kysely, sql } from "kysely";

// Editor-uploaded content images (#485). One row per uploaded image; the
// API generates the responsive variant ladder (AVIF/WebP at several
// widths + an original-format fallback) into the public uploads bucket
// and stores the PictureSource-shaped descriptor here. consent_confirmed
// records that the uploader ticked the photo-consent checkbox (required,
// particularly for juniors) - kept for audit, not as a workflow gate.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("content_image")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("key_prefix", "text", (col) => col.notNull().unique())
    .addColumn("original_format", "text", (col) => col.notNull())
    .addColumn("width", "integer", (col) => col.notNull())
    .addColumn("height", "integer", (col) => col.notNull())
    .addColumn("bytes", "integer", (col) => col.notNull())
    .addColumn("picture", "jsonb", (col) => col.notNull())
    .addColumn("alt", "text")
    .addColumn("consent_confirmed", "boolean", (col) => col.notNull())
    .addColumn("uploaded_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("content_image_uploaded_by_idx")
    .on("content_image")
    .column("uploaded_by")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("content_image").execute();
}
