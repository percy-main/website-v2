import type { Kysely } from "kysely";

// Decouple "create match-fee charges" from "notify players about them".
// Wrapping up a match now only creates the charges; a separate captain
// action sends the donation-request emails/pushes. These columns record
// when (and by whom) that notification batch went out. Null = charges
// exist but no donation requests have been sent yet. One-shot: once set,
// the notify endpoint refuses to re-send (late additions are handled
// manually via the charges admin).
//
// `charges_notified_by` references the user, mirroring the existing
// finished_by / confirmed_by audit columns on this table.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("matchday")
    .addColumn("charges_notified_at", "text")
    .addColumn("charges_notified_by", "text", (col) =>
      col.references("user.id"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("matchday")
    .dropColumn("charges_notified_at")
    .dropColumn("charges_notified_by")
    .execute();
}
