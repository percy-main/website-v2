import { type Kysely, sql } from "kysely";

/**
 * User groups — runtime-defined groupings of members, orthogonal to
 * membership type. Initial use case is filtering availability-request
 * recipients to a single group (e.g. "Senior players", "Womens players")
 * because membership type alone can't express it: a junior member can
 * play senior cricket.
 *
 * The junction keys on `member_id` (not `user_id`) because the
 * availability notify recipient query operates on the `member` table.
 * `member` is 1:1 with `user` via email (backfilled by an earlier
 * migration), so the admin UI passes `memberId` through directly.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("user_group")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("description", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("created_by_user_id", "text", (col) =>
      col.references("user.id").onDelete("set null"),
    )
    .execute();

  await db.schema
    .createTable("user_group_member")
    .addColumn("group_id", "text", (col) =>
      col.notNull().references("user_group.id").onDelete("cascade"),
    )
    .addColumn("member_id", "text", (col) =>
      col.notNull().references("member.id").onDelete("cascade"),
    )
    .addColumn("added_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("added_by_user_id", "text", (col) =>
      col.references("user.id").onDelete("set null"),
    )
    .addPrimaryKeyConstraint("user_group_member_pkey", [
      "group_id",
      "member_id",
    ])
    .execute();

  await db.schema
    .createIndex("user_group_member_member_id_idx")
    .on("user_group_member")
    .column("member_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("user_group_member").execute();
  await db.schema.dropTable("user_group").execute();
}
