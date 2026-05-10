import type { DB } from "@percy-main/db";
import { isCampaignId } from "@percy-main/shared/marketing";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { emitMarketingEvent } from "../marketing/service.ts";
import type { ContactSubmission, EventSubscriber } from "./schemas.ts";

function createSlackNotifier(slackWebhookUrl?: string) {
  return async (data: {
    name: string;
    email: string;
    message: string;
    page: string;
  }) => {
    if (!slackWebhookUrl) return;

    await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `New contact submission from ${data.name} (${data.email}) on ${data.page}:\n${data.message}`,
      }),
    });
  };
}

export function createContactSubmission(
  db: Kysely<DB>,
  config: { slackWebhookUrl?: string },
) {
  const sendSlackNotification = createSlackNotifier(config.slackWebhookUrl);
  const emit = emitMarketingEvent(db);

  return async (data: ContactSubmission, log: FastifyBaseLogger) => {
    const id = crypto.randomUUID();

    await db
      .insertInto("contact_submission")
      .values({
        id,
        name: data.name,
        email: data.email,
        message: data.message,
        page: data.page,
      })
      .execute();

    // Marketing event — never let this fail the submission.
    try {
      const campaignId =
        data.campaignId && isCampaignId(data.campaignId)
          ? data.campaignId
          : null;
      await emit({
        type: "contact_form_submitted",
        campaignId,
        segment: data.segment ?? null,
        attribution: data.attribution ?? null,
        source: "browser",
        payload: { page: data.page, message: data.message.slice(0, 500) },
        // Only create a lead row when this submission is campaign-linked;
        // a general /contact enquiry stays in contact_submission only.
        lead: campaignId
          ? {
              email: data.email,
              name: data.name,
              source: "contact_form",
            }
          : null,
      });
    } catch (err) {
      // Marketing pipeline failures must not affect the contact form
      // response, but log so an SLI / alarm can fire on the warn rate.
      log.warn({ err, submissionId: id }, "marketing_emit_failed");
    }

    // Fire-and-forget — don't block the response on Slack delivery
    sendSlackNotification(data).catch((err: unknown) => {
      log.warn({ err, submissionId: id }, "slack_notify_failed");
    });

    return { id };
  };
}

export function createEventSubscriber(db: Kysely<DB>) {
  return async (data: EventSubscriber) => {
    const id = crypto.randomUUID();

    await db
      .insertInto("event_subscriber")
      .values({
        id,
        email: data.email,
        meta: JSON.stringify(data.meta),
      })
      .execute();

    return { id };
  };
}
