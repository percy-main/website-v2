import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── scout_thread_share: read-only access grants from a thread owner to
  //    other officials/admins. v1 is read-only — recipients can view the
  //    full conversation but cannot post; "branch my thread" is deferred.
  //    One row per (thread, recipient); resharing is a no-op via the
  //    unique constraint. shared_by is denormalised so the FE can render
  //    "Shared by X" without joining back to scout_thread.user_id (which
  //    is also the same person, but keeping it explicit lets us surface
  //    the original sharer if ownership ever transfers later).
  await db.schema
    .createTable("scout_thread_share")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("thread_id", "uuid", (col) =>
      col.notNull().references("scout_thread.id").onDelete("cascade"),
    )
    .addColumn("shared_by_user_id", "text", (col) =>
      col.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("shared_with_user_id", "text", (col) =>
      col.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint("scout_thread_share_unique_recipient", [
      "thread_id",
      "shared_with_user_id",
    ])
    .addCheckConstraint(
      "scout_thread_share_no_self",
      sql`shared_by_user_id <> shared_with_user_id`,
    )
    .execute();

  // Hot path: "list threads shared with me, most-recent first".
  await sql`CREATE INDEX scout_thread_share_recipient_created_idx ON scout_thread_share (shared_with_user_id, created_at DESC)`.execute(
    db,
  );

  // Used when listing the sharees for a single thread (share modal).
  await db.schema
    .createIndex("scout_thread_share_thread_idx")
    .on("scout_thread_share")
    .column("thread_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("scout_thread_share").execute();
}
