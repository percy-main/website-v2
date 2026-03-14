import type { FastifyPluginAsync } from "fastify";
import Stripe from "stripe";
import { match, P } from "ts-pattern";
import { getStripe } from "../lib/stripe.js";

/**
 * Stripe webhook handler.
 *
 * Ported from the Astro API route at src/pages/api/stripe_hook.ts.
 * Uses ts-pattern to route events to the appropriate handler.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Register raw body parser for webhook signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post("/stripe/webhook", async (request, reply) => {
    const stripe = getStripe();
    const sig = request.headers["stripe-signature"];

    if (!sig || typeof sig !== "string") {
      return reply
        .status(400)
        .send({ error: "Missing stripe-signature header" });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body as string,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        request.log.error("Stripe webhook signature verification failed");
        return reply
          .status(400)
          .send({ error: "Invalid webhook signature" });
      }
      throw error;
    }

    try {
      await match(event)
        .with(
          {
            type: P.union(
              "checkout.session.completed",
              "checkout.session.async_payment_succeeded",
            ),
          },
          async (e) => {
            // TODO: port checkoutSessionCompleted handler
            request.log.info(
              { type: e.type },
              "Checkout session completed (handler pending)",
            );
          },
        )
        .with({ type: "invoice.payment_succeeded" }, async (e) => {
          // TODO: port invoicePaymentSucceeded handler
          request.log.info(
            { type: e.type },
            "Invoice payment succeeded (handler pending)",
          );
        })
        .with({ type: "payment_intent.succeeded" }, async (e) => {
          // TODO: port paymentIntentSucceeded handler
          request.log.info(
            { type: e.type },
            "Payment intent succeeded (handler pending)",
          );
        })
        .otherwise(() => {
          // Unhandled event type — log and acknowledge
          request.log.debug({ type: event.type }, "Unhandled Stripe event");
        });

      return reply.status(200).send({});
    } catch (error: unknown) {
      request.log.error(error, "Stripe webhook handler failed");
      return reply
        .status(500)
        .send({ error: "Webhook processing failed" });
    }
  });
};
