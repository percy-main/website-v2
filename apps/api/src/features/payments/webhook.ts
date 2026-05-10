import type { FastifyPluginAsync } from "fastify";
import type Stripe from "stripe";
import { withSpan } from "../../lib/tracing.ts";
import { createStripe } from "./stripe.ts";
import {
  handleCheckoutCompleted,
  handleInvoicePayment,
  handlePaymentIntentSucceeded,
} from "./webhook-service.ts";

/**
 * Marker for handler errors that are permanently terminal — schema
 * mismatches, missing-customer references, etc — where Stripe
 * retrying is pointless. Throw this from a handler to ack the event
 * with 200 (no retry) while still logging the failure.
 */
export class StripeWebhookTerminalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StripeWebhookTerminalError";
  }
}

/**
 * Stripe webhook route plugin.
 *
 * The raw body content-type parser is registered inside an encapsulated
 * sub-plugin so it only applies to the webhook route — not to other
 * routes that expect standard JSON parsing.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const deps = {
    db: app.db,
    stripe,
    log: app.log,
    baseUrl: app.config.BASE_URL,
    send: app.send,
  };

  const onCheckoutCompleted = handleCheckoutCompleted(deps);
  const onInvoicePayment = handleInvoicePayment(deps);
  const onPaymentIntentSucceeded = handlePaymentIntentSucceeded(deps);

  // Encapsulated sub-plugin: raw body parser is scoped to this plugin only
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugin functions must be async
  await app.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (
        _req,
        body: Buffer,
        done: (err: Error | null, body?: unknown) => void,
      ) => {
        done(null, body);
      },
    );

    webhookScope.post("/stripe/webhook", async (request, reply) => {
      const sig = request.headers["stripe-signature"];

      if (!sig) {
        return reply
          .status(400)
          .send({ error: "Missing stripe-signature header" });
      }

      const webhookSecret = app.config.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        request.log.error("STRIPE_WEBHOOK_SECRET is not configured");
        return reply.status(500).send({ error: "Webhook not configured" });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          request.body as Buffer,
          sig,
          webhookSecret,
        );
      } catch (err) {
        // Bumped from warn to error — bad signature is either an
        // attacker probe or a deploy-time secret drift, neither
        // benign.
        request.log.error({ err }, "stripe_webhook_signature_failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      request.log.info(
        { type: event.type, id: event.id },
        "stripe_webhook_received",
      );

      // Idempotency: Stripe delivers each event at-least-once and
      // retries any 5xx for ~3 days. We claim the event with INSERT
      // (or bump `attempts` on conflict) and only short-circuit when
      // a previous attempt actually finished (`processed_at` set).
      // A retry after a mid-handler crash will re-execute — better
      // than silently dropping events because the marker row exists
      // but no work was done (#179).
      const claim = await app.db
        .insertInto("stripe_webhook_event")
        .values({
          id: event.id,
          type: event.type,
          received_at: new Date(),
          attempts: 1,
        })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet((eb) => ({
            attempts: eb("stripe_webhook_event.attempts", "+", 1),
          })),
        )
        .returning(["processed_at", "attempts"])
        .executeTakeFirst();

      if (claim?.processed_at) {
        request.log.info(
          {
            eventId: event.id,
            type: event.type,
            attempts: claim.attempts,
          },
          "stripe_webhook_duplicate_skipped",
        );
        return reply.send({ received: true, duplicate: true });
      }

      const markProcessed = async () => {
        await app.db
          .updateTable("stripe_webhook_event")
          .set({ processed_at: new Date() })
          .where("id", "=", event.id)
          .execute();
      };

      try {
        switch (event.type) {
          case "checkout.session.completed":
          case "checkout.session.async_payment_succeeded":
            await withSpan(
              "stripe.checkout.completed",
              { eventId: event.id, eventType: event.type },
              () => onCheckoutCompleted(event.data.object, event.created),
            );
            break;
          case "invoice.payment_succeeded":
            await withSpan(
              "stripe.invoice.payment",
              { eventId: event.id },
              () => onInvoicePayment(event.data.object, event.created),
            );
            break;
          case "payment_intent.succeeded":
            await withSpan(
              "stripe.payment_intent.succeeded",
              { eventId: event.id },
              () =>
                onPaymentIntentSucceeded(event.data.object, event.created),
            );
            break;
          default:
            request.log.info(
              { type: event.type },
              "stripe_webhook_unhandled_event",
            );
        }
      } catch (err) {
        if (err instanceof StripeWebhookTerminalError) {
          // Don't 5xx — Stripe would retry indefinitely. Log, mark
          // processed (so retries don't reopen the event), and ack.
          request.log.error(
            { err, eventId: event.id, type: event.type },
            "stripe_webhook_terminal_error",
          );
          await markProcessed();
          return reply.send({ received: true, terminalError: true });
        }
        // Retryable — leave processed_at NULL so Stripe's next
        // delivery reclaims and re-runs. Rethrow → Fastify 500 →
        // Stripe retries with backoff.
        throw err;
      }

      await markProcessed();
      return { received: true };
    });
  });
};
