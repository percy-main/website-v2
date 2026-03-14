import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { parseBody } from "../../lib/validation.js";
import { confirmPaymentSchema } from "./schemas.js";
import { getMyCharges, confirmPayment } from "./service.js";

export const chargeRoutes: FastifyPluginAsync = async (app) => {
  const getCharges = getMyCharges(app.db);
  const confirm = confirmPayment(app.db);

  app.get(
    "/charges",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const charges = await getCharges(user.email);
      return { charges };
    },
  );

  app.post(
    "/charges/confirm-payment",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const { paymentIntentId } = parseBody(request, confirmPaymentSchema);
      await confirm(user.email, paymentIntentId);
      return { success: true };
    },
  );
};
