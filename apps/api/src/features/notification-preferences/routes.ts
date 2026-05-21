import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireAuth } from "../auth/middleware.ts";
import {
  notificationPreferencesResponseSchema,
  updateNotificationPreferencesSchema,
} from "./schemas.ts";
import {
  getNotificationPreferences,
  upsertNotificationPreferences,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const notifPrefsRoutes: FastifyPluginAsyncZod = async (app) => {
  const get = getNotificationPreferences(app.db);
  const upsert = upsertNotificationPreferences(app.db);

  app.get(
    "/me/notification-preferences",
    {
      preHandler: [requireAuth],
      schema: {
        response: { 200: notificationPreferencesResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await get(user.id);
    },
  );

  app.put(
    "/me/notification-preferences",
    {
      preHandler: [requireAuth],
      schema: {
        body: updateNotificationPreferencesSchema,
        response: { 200: notificationPreferencesResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await upsert(user.id, request.body);
    },
  );
};
