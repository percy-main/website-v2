import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.js";
import { getAuthSession, requireAuth } from "../auth/middleware.js";
import { confirmPaymentSchema } from "./schemas.js";
import { confirmPayment, getMyCharges } from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const chargeRoutes: FastifyPluginAsync = async (app) => {
  const getCharges = getMyCharges(app.db);
  const confirm = confirmPayment(app.db);

  app.get("/charges", { preHandler: [requireAuth] }, async (request) => {
    const { user } = getAuthSession(request);
    const charges = await getCharges(user.email);
    return { charges };
  });

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
