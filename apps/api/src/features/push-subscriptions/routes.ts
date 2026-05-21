import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireAuth } from "../auth/middleware.ts";
import {
  createPushSubscriptionResponseSchema,
  createPushSubscriptionSchema,
  deletePushSubscriptionResponseSchema,
  deletePushSubscriptionSchema,
  vapidPublicKeyResponseSchema,
} from "./schemas.ts";
import { deletePushSubscription, upsertPushSubscription } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const pushSubscriptionRoutes: FastifyPluginAsyncZod = async (app) => {
  const upsert = upsertPushSubscription(app.db);
  const remove = deletePushSubscription(app.db);

  // Public: the matchday SPA needs the VAPID public key before it can
  // call PushManager.subscribe(). Public key is non-secret by design -
  // it's what identifies us to the push service; anyone with it still
  // can't send a push without the private half.
  app.get(
    "/push/public-key",
    {
      schema: {
        response: { 200: vapidPublicKeyResponseSchema },
      },
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- Fastify expects an async handler
    async () => ({ publicKey: app.config.VAPID_PUBLIC_KEY }),
  );

  app.post(
    "/me/push-subscriptions",
    {
      preHandler: [requireAuth],
      schema: {
        body: createPushSubscriptionSchema,
        response: { 200: createPushSubscriptionResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await upsert(user.id, request.body);
    },
  );

  app.delete(
    "/me/push-subscriptions",
    {
      preHandler: [requireAuth],
      schema: {
        body: deletePushSubscriptionSchema,
        response: { 200: deletePushSubscriptionResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await remove(user.id, request.body.endpoint);
    },
  );
};
