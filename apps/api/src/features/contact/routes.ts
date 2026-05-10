import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  contactResponseSchema,
  contactSubmissionSchema,
  eventSubscriberResponseSchema,
  eventSubscriberSchema,
} from "./schemas.ts";
import { createContactSubmission, createEventSubscriber } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const contactRoutes: FastifyPluginAsyncZod = async (app) => {
  const submitContact = createContactSubmission(app.db, {
    slackWebhookUrl: app.config.SLACK_WEBHOOK_URL,
  });
  const subscribeEvent = createEventSubscriber(app.db);

  app.post(
    "/contact",
    {
      schema: {
        body: contactSubmissionSchema,
        response: { 200: contactResponseSchema },
      },
    },
    async (request) => {
      return await submitContact(request.body, request.log);
    },
  );

  app.post(
    "/events/subscribe",
    {
      schema: {
        body: eventSubscriberSchema,
        response: { 200: eventSubscriberResponseSchema },
      },
    },
    async (request) => {
      return await subscribeEvent(request.body);
    },
  );
};
