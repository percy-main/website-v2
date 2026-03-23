import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add approval workflow columns to matchday_expense
  await db.schema
    .alterTable("matchday_expense")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("draft"))
    .execute();

  await db.schema
    .alterTable("matchday_expense")
    .addColumn("submitted_at", "text")
    .execute();

  await db.schema
    .alterTable("matchday_expense")
    .addColumn("approved_by", "text", (col) => col.references("user.id"))
    .execute();

  await db.schema
    .alterTable("matchday_expense")
    .addColumn("approved_at", "text")
    .execute();

  await db.schema
    .alterTable("matchday_expense")
    .addColumn("rejected_reason", "text")
    .execute();

  await db.schema
    .alterTable("matchday_expense")
    .addColumn("reimbursed_by", "text", (col) => col.references("user.id"))
    .execute();

  await db.schema
    .alterTable("matchday_expense")
    .addColumn("reimbursed_at", "text")
    .execute();

  // Set existing expenses to 'draft' status (already handled by default)
  // Clear existing base64 receipt_image_url data (test data only per clarification)
  await sql`UPDATE matchday_expense SET receipt_image_url = NULL WHERE receipt_image_url LIKE 'data:%'`.execute(
    db,
  );

  // Index for querying expenses by status (pending approvals, pending reimbursements)
  await db.schema
    .createIndex("idx_matchday_expense_status")
    .on("matchday_expense")
    .column("status")
    .execute();
}
