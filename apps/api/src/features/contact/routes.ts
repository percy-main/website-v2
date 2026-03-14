import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.js";
import { contactSubmissionSchema, eventSubscriberSchema } from "./schemas.js";
import { createContactSubmission, createEventSubscriber } from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const contactRoutes: FastifyPluginAsync = async (app) => {
  const submitContact = createContactSubmission(app.db, {
    slackWebhookUrl: app.config.SLACK_WEBHOOK_URL,
  });
  const subscribeEvent = createEventSubscriber(app.db);

  app.post("/contact", async (request) => {
    const data = parseBody(request, contactSubmissionSchema);
    const result = await submitContact(data);
    return result;
  });

  app.post("/events/subscribe", async (request) => {
    const data = parseBody(request, eventSubscriberSchema);
    const result = await subscribeEvent(data);
    return result;
  });
};
