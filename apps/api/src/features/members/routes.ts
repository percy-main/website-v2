import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.js";
import { getAuthSession, requireVerifiedEmail } from "../auth/middleware.js";
import { createStripe } from "../payments/stripe.js";
import { updateMemberSchema } from "./schemas.js";
import {
  getMemberDetails,
  getMyMembership,
  getMySubscriptions,
  updateMemberDetails,
} from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const memberRoutes: FastifyPluginAsync = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const getDetails = getMemberDetails(app.db);
  const getMembership = getMyMembership(app.db);
  const getSubscriptions = getMySubscriptions(stripe);
  const updateDetails = updateMemberDetails(app.db);

  app.get(
    "/members/me",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      const member = await getDetails(user.email);
      return { member };
    },
  );

  app.get(
    "/members/me/membership",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      const membership = await getMembership(user.email);
      return { membership };
    },
  );

  app.get(
    "/members/me/subscriptions",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      const subscriptions = await getSubscriptions(user.email);
      return { subscriptions };
    },
  );

  app.put(
    "/members/me",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      const data = parseBody(request, updateMemberSchema);
      await updateDetails(user.email, data);
      return { success: true };
    },
  );
};
