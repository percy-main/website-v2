import type { Kysely } from "kysely";

/**
 * Cancel-matchday workflow: terminal "cancelled" status distinct from
 * "finished". Used when a fixture is called off and no fees should be
 * raised. Cancel is only permitted before any active charges exist on
 * the matchday; the service enforces that guard.
 *
 * `cancelled_at` / `cancelled_by` are populated when status flips to
 * "cancelled"; `cancelled_reason` is optional free text for the audit
 * trail (rain, opposition withdrew, etc.).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("matchday")
    .addColumn("cancelled_at", "text")
    .execute();

  await db.schema
    .alterTable("matchday")
    .addColumn("cancelled_by", "text", (col) => col.references("user.id"))
    .execute();

  await db.schema
    .alterTable("matchday")
    .addColumn("cancelled_reason", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("matchday").dropColumn("cancelled_at").execute();
  await db.schema.alterTable("matchday").dropColumn("cancelled_by").execute();
  await db.schema
    .alterTable("matchday")
    .dropColumn("cancelled_reason")
    .execute();
}
