import { type Kysely, sql } from "kysely";

// Replace the singular `availability_request.user_group_id` column with
// a join table so an availability request can target multiple groups at
// creation time (matchday amendments §3.1).
//
// Backfill copies existing single-group rows across before the column
// is dropped.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("availability_request_group")
    .addColumn("request_id", "text", (col) =>
      col.notNull().references("availability_request.id").onDelete("cascade"),
    )
    .addColumn("user_group_id", "text", (col) =>
      col.notNull().references("user_group.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addPrimaryKeyConstraint("availability_request_group_pkey", [
      "request_id",
      "user_group_id",
    ])
    .execute();

  await db.schema
    .createIndex("availability_request_group_user_group_idx")
    .on("availability_request_group")
    .column("user_group_id")
    .execute();

  await sql`
    INSERT INTO availability_request_group (request_id, user_group_id)
    SELECT id, user_group_id
    FROM availability_request
    WHERE user_group_id IS NOT NULL
  `.execute(db);

  await db.schema
    .alterTable("availability_request")
    .dropColumn("user_group_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("availability_request")
    .addColumn("user_group_id", "text", (col) =>
      col.references("user_group.id").onDelete("set null"),
    )
    .execute();

  await sql`
    UPDATE availability_request ar
    SET user_group_id = sub.user_group_id
    FROM (
      SELECT DISTINCT ON (request_id) request_id, user_group_id
      FROM availability_request_group
      ORDER BY request_id, created_at ASC
    ) sub
    WHERE ar.id = sub.request_id
  `.execute(db);

  await db.schema.dropTable("availability_request_group").execute();
}
