import type { FastifyPluginAsync } from "fastify";
import type Stripe from "stripe";
import { createStripe } from "./stripe.js";
import {
  handleCheckoutCompleted,
  handleInvoicePayment,
  handlePaymentIntentSucceeded,
} from "./webhook-service.js";

/**
 * Stripe webhook route plugin.
 *
 * The raw body content-type parser is registered inside an encapsulated
 * sub-plugin so it only applies to the webhook route — not to other
 * routes that expect standard JSON parsing.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const stripe = createStripe({ stripeSecretKey: app.config.STRIPE_SECRET_KEY });
  const deps = { db: app.db, stripe, log: app.log };

  const onCheckoutCompleted = handleCheckoutCompleted(deps);
  const onInvoicePayment = handleInvoicePayment(deps);
  const onPaymentIntentSucceeded = handlePaymentIntentSucceeded(deps);

  // Encapsulated sub-plugin: raw body parser is scoped to this plugin only
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugin functions must be async
  await app.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
        done(null, body);
      },
    );

    webhookScope.post("/stripe/webhook", async (request, reply) => {
      const sig = request.headers["stripe-signature"];

      if (!sig) {
        return reply.status(400).send({ error: "Missing stripe-signature header" });
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
        request.log.warn({ err }, "Webhook signature verification failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      request.log.info({ type: event.type, id: event.id }, "Stripe webhook received");

      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          await onCheckoutCompleted(
            event.data.object,
            event.created,
          );
          break;
        case "invoice.payment_succeeded":
          await onInvoicePayment(
            event.data.object,
            event.created,
          );
          break;
        case "payment_intent.succeeded":
          await onPaymentIntentSucceeded(
            event.data.object,
            event.created,
          );
          break;
        default:
          request.log.info({ type: event.type }, "Unhandled webhook event type");
      }

      return { received: true };
    });
  });
};
