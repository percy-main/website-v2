import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  priceInfoParamsSchema,
  priceInfoResponseSchema,
  purchaseResponseSchema,
  purchaseSchema,
  subscribeResponseSchema,
  subscribeSchema,
} from "./schemas.ts";
import { createPurchase, createSubscription, getPriceInfo } from "./service.ts";
import { createStripe } from "./stripe.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const paymentRoutes: FastifyPluginAsyncZod = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const priceInfo = getPriceInfo(stripe);
  const purchase = createPurchase(app.db, stripe);
  const subscribe = createSubscription(app.db, stripe);

  app.get(
    "/price/:priceId",
    {
      schema: {
        params: priceInfoParamsSchema,
        response: { 200: priceInfoResponseSchema },
      },
    },
    async (request) => {
      const { priceId } = request.params;
      return await priceInfo(priceId);
    },
  );

  app.post(
    "/purchase",
    {
      schema: {
        body: purchaseSchema,
        response: { 200: purchaseResponseSchema },
      },
    },
    async (request) => {
      return await purchase(request.body);
    },
  );

  app.post(
    "/subscribe",
    {
      schema: {
        body: subscribeSchema,
        response: { 200: subscribeResponseSchema },
      },
    },
    async (request) => {
      return await subscribe(request.body);
    },
  );
};
