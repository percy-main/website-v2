import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.js";
import { purchaseSchema, subscribeSchema } from "./schemas.js";
import { createPurchase, createSubscription } from "./service.js";

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post("/purchase", async (request) => {
    const data = parseBody(request, purchaseSchema);
    return createPurchase(data);
  });

  app.post("/subscribe", async (request) => {
    const data = parseBody(request, subscribeSchema);
    return createSubscription(data);
  });
};
