import type { Kysely } from "kysely";

/**
 * Stripe webhook idempotency table (#179).
 *
 * Every Stripe webhook event has a globally-unique `event.id`. Stripe
 * delivers each event at-least-once: a 5xx (or any unhandled
 * exception) on the receiver triggers exponential backoff retries for
 * up to ~3 days. Without an idempotency check, every retry re-runs
 * all side effects in handle{CheckoutCompleted,InvoicePayment,
 * PaymentIntentSucceeded} — re-creating charges, re-sending emails,
 * re-firing Slack notifications.
 *
 * Two-column claim pattern:
 *   - `received_at` is set unconditionally on first sight (so we have
 *     an audit row even for events that crash mid-processing)
 *   - `processed_at` is set only after handlers finish successfully
 *     (or terminally fail and we ack); a row whose processed_at IS NULL
 *     is treated as not-yet-handled, so a Stripe retry after a crash
 *     re-runs the handler instead of being skipped as a duplicate.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("stripe_webhook_event")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("received_at", "timestamptz", (col) =>
      col.notNull().defaultTo(db.fn("now")),
    )
    .addColumn("processed_at", "timestamptz")
    .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("stripe_webhook_event").execute();
}
