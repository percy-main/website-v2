import { type Kysely, sql } from "kysely";

/**
 * Financial relief workflow.
 *
 * Three new tables plus relief columns on `charge`:
 *
 *  - financial_relief_request  — the member-submitted application form.
 *    A partial unique index limits to one open request per member.
 *
 *  - financial_relief_grant    — created when an admin approves a request.
 *    Declines are NEVER persisted as grants (they live on the request +
 *    an event). A partial unique index limits to one active grant per
 *    member.
 *
 *  - financial_relief_event    — append-only audit trail of status
 *    transitions, decisions, notes, and the membership-relief action.
 *
 * Relief columns on `charge` mirror the deleted_at/by/reason audit
 * triplet pattern used elsewhere in the schema. `original_amount_pence`
 * is set ONLY on the partial-relief path so reporting can sum
 * `COALESCE(original_amount_pence, amount_pence)` to recover the full
 * pre-relief value without sibling rows.
 *
 * The check constraint `charge_relief_consistent` enforces that the
 * three relief audit fields move together.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- financial_relief_request ---------------------------------------
  await db.schema
    .createTable("financial_relief_request")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("submitted_by_user_id", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("member_id", "text", (col) =>
      col.notNull().references("member.id"),
    )
    .addColumn("status", "text", (col) => col.notNull().defaultTo("submitted"))
    .addColumn("requested_membership_full", "boolean", (col) => col.notNull())
    .addColumn("requested_membership_partial", "boolean", (col) =>
      col.notNull(),
    )
    .addColumn("requested_match_fees", "boolean", (col) => col.notNull())
    .addColumn("partial_amount_pence", "integer")
    .addColumn("reason_category", "text")
    .addColumn("reason_text", "text")
    .addColumn("duration", "text")
    .addColumn("duration_other_text", "text")
    .addColumn("contribution_ability", "text")
    .addColumn("contribution_amount_pence", "integer")
    .addColumn("volunteer_options", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("volunteer_notes", "text")
    .addColumn("contact_preference", "text", (col) => col.notNull())
    .addColumn("privacy_acknowledged_at", "timestamptz", (col) => col.notNull())
    .addColumn("declaration_confirmed_at", "timestamptz", (col) =>
      col.notNull(),
    )
    .addColumn("withdrawn_at", "timestamptz")
    .addColumn("withdrawn_reason", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "financial_relief_request_status_check",
      sql`status IN ('submitted','in_review','more_info_needed','approved','declined','withdrawn','expired')`,
    )
    .addCheckConstraint(
      "financial_relief_request_contact_pref_check",
      sql`contact_preference IN ('none','email','phone','in_person')`,
    )
    .execute();

  await db.schema
    .createIndex("financial_relief_request_member_id_idx")
    .on("financial_relief_request")
    .column("member_id")
    .execute();

  // One open request per member. Partial unique index — DB-level
  // guarantee against the race the service tries to avoid with locks.
  await sql`
    CREATE UNIQUE INDEX financial_relief_request_one_open_uidx
      ON financial_relief_request (member_id)
      WHERE status IN ('submitted','in_review','more_info_needed')
  `.execute(db);

  // --- financial_relief_grant -----------------------------------------
  await db.schema
    .createTable("financial_relief_grant")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("request_id", "text", (col) =>
      col.notNull().references("financial_relief_request.id"),
    )
    .addColumn("member_id", "text", (col) =>
      col.notNull().references("member.id"),
    )
    .addColumn("decision", "text", (col) => col.notNull())
    .addColumn("covers_membership", "boolean", (col) => col.notNull())
    .addColumn("covers_match_fees", "boolean", (col) => col.notNull())
    .addColumn("membership_partial_pence", "integer")
    .addColumn("effective_from", "date", (col) => col.notNull())
    .addColumn("effective_to_exclusive", "date")
    .addColumn("admin_notes", "text")
    .addColumn("member_facing_note", "text")
    .addColumn("decided_by", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("decided_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("closed_at", "timestamptz")
    .addColumn("closed_by", "text", (col) => col.references("user.id"))
    .addColumn("closed_reason", "text")
    .addCheckConstraint(
      "financial_relief_grant_decision_check",
      sql`decision IN ('approved_full','approved_partial','approved_temporary')`,
    )
    .addCheckConstraint(
      "financial_relief_grant_closed_consistent_check",
      sql`(closed_at IS NULL AND closed_by IS NULL) OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)`,
    )
    .execute();

  // One active grant per member.
  await sql`
    CREATE UNIQUE INDEX financial_relief_grant_one_active_uidx
      ON financial_relief_grant (member_id)
      WHERE closed_at IS NULL
  `.execute(db);

  // --- financial_relief_event -----------------------------------------
  await db.schema
    .createTable("financial_relief_event")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("request_id", "text", (col) =>
      col.notNull().references("financial_relief_request.id"),
    )
    .addColumn("event_type", "text", (col) => col.notNull())
    .addColumn("from_status", "text")
    .addColumn("to_status", "text")
    .addColumn("note", "text")
    .addColumn("actor_user_id", "text", (col) =>
      col.notNull().references("user.id"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      "financial_relief_event_type_check",
      sql`event_type IN ('status_changed','note_added','more_info_requested','grant_created','grant_closed','declined','withdrawn','membership_relief_applied')`,
    )
    .execute();

  await db.schema
    .createIndex("financial_relief_event_request_id_idx")
    .on("financial_relief_event")
    .columns(["request_id", "created_at"])
    .execute();

  // --- relief columns on charge ---------------------------------------
  // Stored as text to match the existing deleted_at column convention
  // on this table.
  await db.schema
    .alterTable("charge")
    .addColumn("relieved_at", "text")
    .execute();
  await db.schema
    .alterTable("charge")
    .addColumn("relieved_by", "text", (col) => col.references("user.id"))
    .execute();
  await db.schema
    .alterTable("charge")
    .addColumn("relieved_reason", "text")
    .execute();
  await db.schema
    .alterTable("charge")
    .addColumn("relief_grant_id", "text", (col) =>
      col.references("financial_relief_grant.id"),
    )
    .execute();
  await db.schema
    .alterTable("charge")
    .addColumn("original_amount_pence", "integer")
    .execute();

  await sql`
    ALTER TABLE charge ADD CONSTRAINT charge_relief_consistent CHECK (
      (relieved_at IS NULL AND relieved_by IS NULL AND relieved_reason IS NULL AND original_amount_pence IS NULL)
      OR
      (relieved_at IS NOT NULL AND relieved_by IS NOT NULL AND relieved_reason IS NOT NULL)
    )
  `.execute(db);

  await sql`
    CREATE INDEX charge_relieved_at_idx
      ON charge (relieved_at)
      WHERE relieved_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE charge DROP CONSTRAINT IF EXISTS charge_relief_consistent`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS charge_relieved_at_idx`.execute(db);
  await db.schema
    .alterTable("charge")
    .dropColumn("original_amount_pence")
    .execute();
  await db.schema.alterTable("charge").dropColumn("relief_grant_id").execute();
  await db.schema.alterTable("charge").dropColumn("relieved_reason").execute();
  await db.schema.alterTable("charge").dropColumn("relieved_by").execute();
  await db.schema.alterTable("charge").dropColumn("relieved_at").execute();

  await db.schema.dropTable("financial_relief_event").execute();
  await db.schema.dropTable("financial_relief_grant").execute();
  await db.schema.dropTable("financial_relief_request").execute();
}
