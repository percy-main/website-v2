import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
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

  return async (data: ContactSubmission) => {
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

    // Fire-and-forget — don't block the response on Slack delivery
    sendSlackNotification(data).catch(() => {
      // Silently ignore Slack failures
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
