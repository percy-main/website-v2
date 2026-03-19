import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams } from "../../lib/validation.ts";
import {
  priceInfoParamsSchema,
  purchaseSchema,
  subscribeSchema,
} from "./schemas.ts";
import { createPurchase, createSubscription, getPriceInfo } from "./service.ts";
import { createStripe } from "./stripe.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const paymentRoutes: FastifyPluginAsync = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const priceInfo = getPriceInfo(stripe);
  const purchase = createPurchase(app.db, stripe);
  const subscribe = createSubscription(app.db, stripe);

  app.get("/price/:priceId", async (request) => {
    const { priceId } = parseParams(request, priceInfoParamsSchema);
    return await priceInfo(priceId);
  });

  app.post("/purchase", async (request) => {
    const data = parseBody(request, purchaseSchema);
    return await purchase(data);
  });

  app.post("/subscribe", async (request) => {
    const data = parseBody(request, subscribeSchema);
    return await subscribe(data);
  });
};
