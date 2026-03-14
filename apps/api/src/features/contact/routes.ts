import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../lib/validation.js";
import { contactSubmissionSchema, eventSubscriberSchema } from "./schemas.js";
import {
  createContactSubmission,
  createEventSubscriber,
} from "./service.js";

export const contactRoutes: FastifyPluginAsync = async (app) => {
  app.post("/contact", async (request) => {
    const data = parseBody(request, contactSubmissionSchema);
    const result = await createContactSubmission(data);
    return result;
  });

  app.post("/events/subscribe", async (request) => {
    const data = parseBody(request, eventSubscriberSchema);
    const result = await createEventSubscriber(data);
    return result;
  });
};
