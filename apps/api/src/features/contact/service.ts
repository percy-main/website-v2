import { client } from "@percy-main/db";
import type { ContactSubmission, EventSubscriber } from "./schemas.js";

async function sendSlackNotification(data: {
  name: string;
  email: string;
  message: string;
  page: string;
}) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `New contact submission from ${data.name} (${data.email}) on ${data.page}:\n${data.message}`,
    }),
  });
}

export async function createContactSubmission(data: ContactSubmission) {
  const id = crypto.randomUUID();

  await client
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
}

export async function createEventSubscriber(data: EventSubscriber) {
  const id = crypto.randomUUID();

  await client
    .insertInto("event_subscriber")
    .values({
      id,
      email: data.email,
      meta: JSON.stringify(data.meta),
    })
    .execute();

  return { id };
}
