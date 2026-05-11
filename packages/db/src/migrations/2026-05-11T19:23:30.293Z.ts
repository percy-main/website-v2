import { type Kysely, sql } from "kysely";

/**
 * Link a member (typically a junior who self-registered) to one or more
 * parent members. Used so that charges raised against the junior surface
 * on the parent's "to pay" list instead of the junior's, and so that
 * payOutstandingCharges bundles them together. Many-to-many to support
 * two-parent households. Admin-managed only — no self-service linking.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("member_parent_link")
    .addColumn("member_id", "text", (col) =>
      col.notNull().references("member.id").onDelete("cascade"),
    )
    .addColumn("parent_member_id", "text", (col) =>
      col.notNull().references("member.id").onDelete("cascade"),
    )
    .addColumn("created_at", "text", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("created_by", "text", (col) =>
      col.references("user.id").onDelete("set null"),
    )
    .addPrimaryKeyConstraint("member_parent_link_pkey", [
      "member_id",
      "parent_member_id",
    ])
    .addCheckConstraint(
      "member_parent_link_no_self_check",
      sql`member_id <> parent_member_id`,
    )
    .execute();

  await db.schema
    .createIndex("idx_member_parent_link_parent")
    .on("member_parent_link")
    .column("parent_member_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("member_parent_link").execute();
}
