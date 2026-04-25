import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireRole } from "../auth/middleware.ts";
import {
  leadEventsQuerySchema,
  leadEventsResponseSchema,
  listLeadsQuerySchema,
  listLeadsResponseSchema,
} from "./admin-schemas.ts";
import { getLeadEvents, listLeads } from "./admin-service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const marketingAdminRoutes: FastifyPluginAsyncZod = async (app) => {
  const list = listLeads(app.db);
  const events = getLeadEvents(app.db);

  app.get(
    "/admin/leads",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listLeadsQuerySchema,
        response: { 200: listLeadsResponseSchema },
      },
    },
    async (request) => {
      return await list(request.query);
    },
  );

  app.get(
    "/admin/marketing-events",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: leadEventsQuerySchema,
        response: { 200: leadEventsResponseSchema },
      },
    },
    async (request) => {
      return await events(request.query.leadId);
    },
  );
};
