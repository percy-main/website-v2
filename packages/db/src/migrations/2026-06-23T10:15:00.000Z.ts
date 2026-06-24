import { type Kysely, sql } from "kysely";

// Profile self-editing review tier (#575).
//
// A club member whose `member` row is slug-linked to their person
// `content_item` may propose edits to their own profile (bio body + photo
// only). The edit is NOT applied directly: it lands here as a
// content_proposal awaiting review. A content_people:publish editor then
// approves (wholesale-replacing the person item's body/metadata and writing
// a content_revision) or rejects (with an optional decision_note). This is
// the "review tier" the content permission model deliberately reserved by
// keeping manage and publish distinct (packages/shared auth/permissions.ts).
//
// Only the bio (body) and photo are self-editable; title/slug and the
// safeguarding flags (isDBSChecked / hasLeftClub) stay admin-only, so the
// proposal stores just the proposed body and a photo-only metadata subset.
// proposed_metadata is `{}` or `{ "photo": ... }`; approval merges the photo
// onto the live metadata, leaving the safeguarding flags untouched.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("content_proposal")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // The person content_item this proposal edits. No ON DELETE CASCADE:
    // content_item is never hard-deleted (archive instead), matching the
    // content_revision foreign key.
    .addColumn("content_id", "uuid", (col) =>
      col.notNull().references("content_item.id"),
    )
    .addColumn("proposed_body", "jsonb", (col) => col.notNull())
    // Photo-only metadata subset ({} or { photo }); approval merges it onto
    // the live person metadata so the safeguarding flags are never touched.
    .addColumn("proposed_metadata", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("proposed_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    // Reviewer columns mirror the matchday_expense approval precedent: null
    // until a content_people:publish editor decides.
    .addColumn("reviewed_by", "text", (col) => col.references("user.id"))
    .addColumn("reviewed_at", "timestamptz")
    // Carried back to the proposer on rejection (the "why").
    .addColumn("decision_note", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "content_proposal_status_check",
      sql`status IN ('pending','approved','rejected')`,
    )
    .execute();

  // One open proposal per profile at a time: block a second submission while
  // one is still pending. Approved/rejected rows are historical and excluded
  // by the partial predicate, so a member can submit again once reviewed.
  await db.schema
    .createIndex("content_proposal_one_pending_per_content")
    .on("content_proposal")
    .column("content_id")
    .unique()
    .where(sql.ref("status"), "=", sql.lit("pending"))
    .execute();

  // The review queue lists pending proposals oldest-first.
  await db.schema
    .createIndex("content_proposal_status_created_at_idx")
    .on("content_proposal")
    .columns(["status", "created_at"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("content_proposal").execute();
}
