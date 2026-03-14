import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type Stripe from "stripe";
import { createStripe } from "./stripe.js";

/**
 * Handle checkout.session.completed events.
 * TODO: Port full handler from v1 — needs payment handler code.
 */
async function handleCheckoutCompleted(
  _session: Stripe.Checkout.Session,
): Promise<void> {
  // TODO: Look up charge by session metadata, mark as paid,
  // create/extend membership records, send confirmation email
}

/**
 * Handle invoice.payment_succeeded events (subscription renewals).
 * TODO: Port full handler from v1 — needs payment handler code.
 */
async function handleInvoicePayment(
  _invoice: Stripe.Invoice,
): Promise<void> {
  // TODO: Extend membership paid_until date,
  // handle failed payment notifications
}

/**
 * Handle payment_intent.succeeded events (one-off purchases).
 * TODO: Port full handler from v1 — needs payment handler code.
 */
async function handlePaymentIntentSucceeded(
  _paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  // TODO: Confirm charge payment, update charge record,
  // process purchase-specific logic based on metadata
}

/**
 * Stripe webhook route plugin.
 * Registers with raw body parsing for signature verification.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const stripe = createStripe({ stripeSecretKey: app.config.STRIPE_SECRET_KEY });

  // Register raw body content type parser for webhook verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
      done(null, body);
    },
  );

  app.post("/stripe/webhook", async (request, reply) => {
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
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePayment(event.data.object as Stripe.Invoice);
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(
          event.data.object as Stripe.PaymentIntent,
        );
        break;
      default:
        request.log.info({ type: event.type }, "Unhandled webhook event type");
    }

    return { received: true };
  });
};
