import { type Kysely, sql } from "kysely";

// Database foundation for live content editing (#479 / #480).
//
// content_item is one table for every editable content kind (page | news |
// event | game_report | person) with a kind discriminator. The kinds share
// 90% of their shape; kind-specific fields live in Zod-validated JSONB
// metadata (replacing MDX frontmatter). The body is the BlockNote editor
// JSON document stored as JSONB - ADR 047 superseded the epic's original
// markdown-canonical plan.
//
// content_revision captures every save from day one (history cannot be
// retrofitted; vandalism/accidental-deletion recovery is one query).
// Revisions are kept forever; restore/diff UI arrives in Phase 4.
//
// Hierarchy (pages only) is an adjacency list via parent_id plus a
// materialised URL path - the page corpus is ~30 rows, so a single SELECT
// rebuilds the nav tree. Slug and path lock after first publish, so no
// redirect handling exists anywhere.
//
// Scheduled publishing is just a future published_at: public queries serve
// only status = 'published' AND published_at <= now(). No scheduler.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("content_item")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("slug", "text", (col) => col.notNull())
    .addColumn("parent_id", "uuid", (col) => col.references("content_item.id"))
    .addColumn("path", "text", (col) => col.unique())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("body", "jsonb", (col) => col.notNull())
    .addColumn("metadata", "jsonb", (col) => col.notNull().defaultTo("{}"))
    .addColumn("status", "text", (col) => col.notNull().defaultTo("draft"))
    .addColumn("published_at", "timestamptz")
    .addColumn("created_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("updated_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "content_item_kind_check",
      sql`kind IN ('page','news','event','game_report','person')`,
    )
    .addCheckConstraint(
      "content_item_status_check",
      sql`status IN ('draft','published','archived')`,
    )
    .execute();

  // Public listing queries filter on kind + status and order/filter by
  // published_at.
  await db.schema
    .createIndex("content_item_kind_status_published_at_idx")
    .on("content_item")
    .columns(["kind", "status", "published_at"])
    .execute();

  // Slug uniqueness is per-kind for flat kinds (everything without a parent).
  // Hierarchical pages get uniqueness from the materialised path instead.
  await db.schema
    .createIndex("content_item_kind_slug_key")
    .on("content_item")
    .columns(["kind", "slug"])
    .unique()
    .where("parent_id", "is", null)
    .execute();

  await db.schema
    .createIndex("content_item_parent_id_idx")
    .on("content_item")
    .column("parent_id")
    .execute();

  await db.schema
    .createTable("content_revision")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("content_id", "uuid", (col) =>
      col.notNull().references("content_item.id").onDelete("cascade"),
    )
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("body", "jsonb", (col) => col.notNull())
    .addColumn("metadata", "jsonb", (col) => col.notNull())
    .addColumn("saved_by", "text", (col) => col.notNull().references("user.id"))
    .addColumn("saved_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("content_revision_content_id_idx")
    .on("content_revision")
    .column("content_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("content_revision").execute();
  await db.schema.dropTable("content_item").execute();
}
