import { type Kysely, sql } from "kysely";

// Expenses reimbursement (EXPENSES.md). A standalone, audited expense-claim
// workflow: a submitter raises a claim (optional receipt + proposed tags),
// approvers approve/deny (two distinct approvers required for GBP 50+), and an
// approved claim is paid via Stripe Global Payouts (Phase 2) or marked paid
// manually (Phase 1 fallback).
//
// Tables:
//   expense                 - the claim + lifecycle status + Stripe payout linkage
//   expense_approval         - one decision row per approver (enforces the
//                              two-distinct-approver rule and separation of duties)
//   expense_category         - admin-editable tag vocabulary (grows by proposal)
//   expense_category_link    - many-to-many: an expense carries one or more tags
//   expense_event            - append-only audit log of every transition

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("expense")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // The submitter. Referenced (not cascade) so a claim's audit trail
    // survives even if the user account is later removed.
    .addColumn("created_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("claimant_name", "text", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("amount_pence", "integer", (col) => col.notNull())
    .addColumn("currency", "text", (col) => col.notNull().defaultTo("gbp"))
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("receipt_image_url", "text")
    // Stripe Global Payouts linkage (Phase 2). Nullable: a claim has no
    // payout objects until it is paid.
    .addColumn("stripe_recipient_account_id", "text")
    .addColumn("stripe_payout_method_id", "text")
    // Unique so a retried payout can never create a second OutboundPayment
    // for the same claim.
    .addColumn("stripe_outbound_payment_id", "text", (col) => col.unique())
    .addColumn("payout_failure_reason", "text")
    .addColumn("paid_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint("expense_amount_positive_check", sql`amount_pence > 0`)
    .addCheckConstraint(
      "expense_status_check",
      sql`status IN ('pending','awaiting_second_approval','approved','denied','paid','payout_failed')`,
    )
    .execute();

  await db.schema
    .createIndex("expense_status_idx")
    .on("expense")
    .column("status")
    .execute();

  await db.schema
    .createIndex("expense_created_by_idx")
    .on("expense")
    .column("created_by")
    .execute();

  await db.schema
    .createTable("expense_approval")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("expense_id", "uuid", (col) =>
      col.notNull().references("expense.id").onDelete("cascade"),
    )
    .addColumn("approver_user_id", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("decision", "text", (col) => col.notNull())
    .addColumn("note", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "expense_approval_decision_check",
      sql`decision IN ('approved','denied')`,
    )
    // One decision per approver per claim: the two approvals a GBP 50+ claim
    // needs therefore must come from two distinct users.
    .addUniqueConstraint("expense_approval_one_per_approver_uniq", [
      "expense_id",
      "approver_user_id",
    ])
    .execute();

  await db.schema
    .createIndex("expense_approval_expense_id_idx")
    .on("expense_approval")
    .column("expense_id")
    .execute();

  await db.schema
    .createTable("expense_category")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_by", "text", (col) => col.references("user.id"))
    .addColumn("archived_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // Case-insensitive uniqueness on the tag name so "Fuel" and "fuel" can't
  // both exist; the service upserts proposed tags against this.
  await sql`CREATE UNIQUE INDEX expense_category_name_lower_uniq ON expense_category (lower(name))`.execute(
    db,
  );

  await db.schema
    .createTable("expense_category_link")
    .addColumn("expense_id", "uuid", (col) =>
      col.notNull().references("expense.id").onDelete("cascade"),
    )
    // Restrict (default): a tag in use can't be hard-deleted; admins archive
    // it instead, preserving historical links.
    .addColumn("category_id", "uuid", (col) =>
      col.notNull().references("expense_category.id"),
    )
    .addPrimaryKeyConstraint("expense_category_link_pkey", [
      "expense_id",
      "category_id",
    ])
    .execute();

  await db.schema
    .createTable("expense_event")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("expense_id", "uuid", (col) =>
      col.notNull().references("expense.id").onDelete("cascade"),
    )
    // Null for Stripe-system events (e.g. a webhook-driven payout outcome).
    .addColumn("actor_user_id", "text", (col) => col.references("user.id"))
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("from_status", "text")
    .addColumn("to_status", "text")
    .addColumn("metadata", "jsonb")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex("expense_event_expense_id_idx")
    .on("expense_event")
    .column("expense_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("expense_event").execute();
  await db.schema.dropTable("expense_category_link").execute();
  await db.schema.dropTable("expense_category").execute();
  await db.schema.dropTable("expense_approval").execute();
  await db.schema.dropTable("expense").execute();
}
