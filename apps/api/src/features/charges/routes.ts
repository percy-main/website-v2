import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.ts";
import { getAuthSession, requireAuth } from "../auth/middleware.ts";
import { createStripe } from "../payments/stripe.ts";
import { confirmPaymentSchema } from "./schemas.ts";
import {
  confirmPayment,
  getMyCharges,
  payOutstandingCharges,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const chargeRoutes: FastifyPluginAsync = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const getCharges = getMyCharges(app.db);
  const payOutstanding = payOutstandingCharges(app.db, stripe);
  const confirm = confirmPayment(app.db);

  app.get("/charges", { preHandler: [requireAuth] }, async (request) => {
    const { user } = getAuthSession(request);
    const charges = await getCharges(user.email);
    return { charges };
  });

  app.post(
    "/charges/pay-outstanding",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      return await payOutstanding(user.email);
    },
  );

  app.post(
    "/charges/confirm-payment",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { paymentIntentId } = parseBody(request, confirmPaymentSchema);
      await confirm(user.email, paymentIntentId);
      return { success: true };
    },
  );
};
