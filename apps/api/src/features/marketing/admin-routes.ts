import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireRole } from "../auth/middleware.ts";
import {
  adminOutcomeBodySchema,
  adminOutcomeResponseSchema,
  leadEventsQuerySchema,
  leadEventsResponseSchema,
  leadIdParamSchema,
  listLeadsQuerySchema,
  listLeadsResponseSchema,
  listOutboxQuerySchema,
  listOutboxResponseSchema,
  retryOutboxParamSchema,
  retryOutboxResponseSchema,
} from "./admin-schemas.ts";
import {
  getLeadEvents,
  listLeads,
  listOutbox,
  retryOutbox,
} from "./admin-service.ts";
import { emitMarketingEvent } from "./service.ts";

const OUTCOME_TO_EVENT = {
  contacted: "lead_contacted",
  attended: "lead_attended_session",
  joined: "lead_became_member",
  lost: "lead_lost",
} as const;

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const marketingAdminRoutes: FastifyPluginAsyncZod = async (app) => {
  const list = listLeads(app.db);
  const events = getLeadEvents(app.db);
  const outbox = listOutbox(app.db);
  const retry = retryOutbox(app.db);
  const emit = emitMarketingEvent(app.db);

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

  app.post(
    "/admin/leads/:leadId/outcomes",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: leadIdParamSchema,
        body: adminOutcomeBodySchema,
        response: { 200: adminOutcomeResponseSchema },
      },
    },
    async (request) => {
      const { leadId } = request.params;
      const { outcome, notes, memberId } = request.body;

      const existing = await app.db
        .selectFrom("lead")
        .select(["first_campaign_id", "first_segment"])
        .where("id", "=", leadId)
        .executeTakeFirstOrThrow();

      if (outcome === "joined" && memberId) {
        await app.db
          .updateTable("lead")
          .set({ member_id: memberId, updated_at: new Date().toISOString() })
          .where("id", "=", leadId)
          .execute();
      }

      const valuePence = outcome === "joined" ? 5000 : null;

      const result = await emit({
        type: OUTCOME_TO_EVENT[outcome],
        leadId,
        campaignId: existing.first_campaign_id,
        segment: existing.first_segment,
        source: "admin",
        createdBy: request.authSession?.user.id,
        value: valuePence ? { pence: valuePence, currency: "GBP" } : null,
        payload: notes ? { notes } : null,
      });

      return { ok: true as const, eventId: result.eventId };
    },
  );

  app.get(
    "/admin/marketing-outbox",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listOutboxQuerySchema,
        response: { 200: listOutboxResponseSchema },
      },
    },
    async (request) => {
      return await outbox(request.query);
    },
  );

  app.post(
    "/admin/marketing-outbox/:outboxId/retry",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: retryOutboxParamSchema,
        response: { 200: retryOutboxResponseSchema },
      },
    },
    async (request) => {
      await retry(request.params.outboxId);
      return { ok: true as const };
    },
  );
};
