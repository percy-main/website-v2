import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireAuth } from "../auth/middleware.ts";
import { createStripe } from "../payments/stripe.ts";
import {
  chargesResponseSchema,
  confirmPaymentResponseSchema,
  confirmPaymentSchema,
  payOutstandingResponseSchema,
  payOutstandingSchema,
} from "./schemas.ts";
import {
  confirmPayment,
  getMyCharges,
  payOutstandingCharges,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const chargeRoutes: FastifyPluginAsyncZod = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const getCharges = getMyCharges(app.db);
  const payOutstanding = payOutstandingCharges(app.db, stripe);
  const confirm = confirmPayment(app.db);

  app.get(
    "/charges",
    {
      preHandler: [requireAuth],
      schema: {
        response: { 200: chargesResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const charges = await getCharges(user.email);
      return { charges };
    },
  );

  app.post(
    "/charges/pay-outstanding",
    {
      preHandler: [requireAuth],
      schema: {
        body: payOutstandingSchema,
        response: { 200: payOutstandingResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await payOutstanding(user.email, request.body.chargeIds);
    },
  );

  app.post(
    "/charges/confirm-payment",
    {
      preHandler: [requireAuth],
      schema: {
        body: confirmPaymentSchema,
        response: { 200: confirmPaymentResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      await confirm(user.email, request.body.paymentIntentId);
      return { success: true as const };
    },
  );
};
