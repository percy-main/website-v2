import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireVerifiedEmail } from "../auth/middleware.ts";
import { createStripe } from "../payments/stripe.ts";
import {
  memberDetailsResponseSchema,
  membershipResponseSchema,
  subscriptionsResponseSchema,
  updateMemberResponseSchema,
  updateMemberSchema,
} from "./schemas.ts";
import {
  getMemberDetails,
  getMyMembership,
  getMySubscriptions,
  updateMemberDetails,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const getDetails = getMemberDetails(app.db);
  const getMembership = getMyMembership(app.db);
  const getSubscriptions = getMySubscriptions(stripe);
  const updateDetails = updateMemberDetails(app.db);

  app.get(
    "/members/me",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        response: { 200: memberDetailsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const member = await getDetails(user.email);
      return { member };
    },
  );

  app.get(
    "/members/me/membership",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        response: { 200: membershipResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const membership = await getMembership(user.email);
      return { membership };
    },
  );

  app.get(
    "/members/me/subscriptions",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        response: { 200: subscriptionsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const subscriptions = await getSubscriptions(user.email);
      return { subscriptions };
    },
  );

  app.put(
    "/members/me",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        body: updateMemberSchema,
        response: { 200: updateMemberResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      await updateDetails(user.email, request.body);
      return { success: true as const };
    },
  );
};
