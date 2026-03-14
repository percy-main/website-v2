import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.js";
import { purchaseSchema, subscribeSchema } from "./schemas.js";
import { createPurchase, createSubscription } from "./service.js";
import { createStripe } from "./stripe.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const paymentRoutes: FastifyPluginAsync = async (app) => {
  const stripe = createStripe({ stripeSecretKey: app.config.STRIPE_SECRET_KEY });
  const purchase = createPurchase(app.db, stripe);
  const subscribe = createSubscription(app.db, stripe);

  app.post("/purchase", async (request) => {
    const data = parseBody(request, purchaseSchema);
    return await purchase(data);
  });

  app.post("/subscribe", async (request) => {
    const data = parseBody(request, subscribeSchema);
    return await subscribe(data);
  });
};
