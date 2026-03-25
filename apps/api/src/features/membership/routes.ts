import { stripeConfig } from "@percy-main/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createStripe } from "../payments/stripe.ts";
import { membershipPricesResponseSchema } from "./schemas.ts";
import { getMembershipPrices } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const membershipRoutes: FastifyPluginAsyncZod = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const config = app.config.STRIPE_SECRET_KEY.startsWith("sk_live_")
    ? stripeConfig.live
    : stripeConfig.dev;
  const prices = getMembershipPrices(stripe, config);

  app.get(
    "/membership/prices",
    {
      schema: {
        response: { 200: membershipPricesResponseSchema },
      },
    },
    async () => {
      return await prices();
    },
  );
};
