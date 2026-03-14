import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { parseBody } from "../../lib/validation.js";
import { confirmPaymentSchema } from "./schemas.js";
import { getMyCharges, confirmPayment } from "./service.js";

export const chargeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/charges",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const charges = await getMyCharges(user.email);
      return { charges };
    },
  );

  app.post(
    "/charges/confirm-payment",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const { paymentIntentId } = parseBody(request, confirmPaymentSchema);
      await confirmPayment(user.email, paymentIntentId);
      return { success: true };
    },
  );
};
