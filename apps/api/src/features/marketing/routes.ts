import { isCampaignId } from "@percy-main/shared/marketing";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createRateLimiter } from "./rate-limiter.ts";
import {
  marketingLeadErrorSchema,
  marketingLeadResponseSchema,
  marketingLeadSchema,
} from "./schemas.ts";
import { emitMarketingEvent } from "./service.ts";
import { createLeadSlackNotifier } from "./slack.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const marketingRoutes: FastifyPluginAsyncZod = async (app) => {
  const emit = emitMarketingEvent(app.db);
  const slackNotify = createLeadSlackNotifier(app.config.SLACK_WEBHOOK_URL);

  // 5 submissions per IP per 10 minutes; same window per email.
  const ipLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
  const emailLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

  app.post(
    "/marketing/leads",
    {
      schema: {
        body: marketingLeadSchema,
        response: {
          200: marketingLeadResponseSchema,
          400: marketingLeadErrorSchema,
          429: marketingLeadErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      // Honeypot — silently 200 with a synthetic id; do not write anything.
      if (body.honeypot && body.honeypot.length > 0) {
        return { leadId: "ignored" };
      }

      if (!isCampaignId(body.campaignId)) {
        return reply.code(400).send({ error: "Unknown campaignId" });
      }

      const ipKey = request.ip ?? "unknown-ip";
      const emailKey = body.email.toLowerCase();
      const ipCheck = ipLimiter.check(ipKey);
      const emailCheck = emailLimiter.check(emailKey);
      if (!ipCheck.allowed || !emailCheck.allowed) {
        return reply
          .code(429)
          .header(
            "Retry-After",
            String(
              Math.max(ipCheck.retryAfterSeconds, emailCheck.retryAfterSeconds),
            ),
          )
          .send({ error: "Too many submissions. Please try again later." });
      }

      const result = await emit({
        type: "generate_lead",
        campaignId: body.campaignId,
        segment: body.segment ?? null,
        attribution: body.attribution ?? null,
        source: "browser",
        payload: body.fields ?? null,
        lead: {
          email: body.email,
          name: body.name,
          phone: body.phone ?? null,
          source: body.source,
          consent: body.consent,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- generate_lead always creates a lead
      const leadId = result.leadId!;

      // Fire-and-forget Slack notification.
      void slackNotify({
        baseUrl: app.config.BASE_URL,
        campaignId: body.campaignId,
        segment: body.segment,
        name: body.name,
        email: body.email,
        phone: body.phone,
        notes:
          typeof body.fields?.notes === "string" ? body.fields.notes : null,
        leadId,
      });

      return { leadId };
    },
  );
};
