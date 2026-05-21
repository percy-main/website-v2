import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  PushSubscriptionInput,
  SendPush,
  SendPushResult,
} from "../../lib/push-sender.ts";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { upsertNotificationPreferences } from "../notification-preferences/service.ts";
import { upsertPushSubscription } from "../push-subscriptions/service.ts";
import { sendAvailabilityNotification } from "./service.ts";

const log = createNoopLogger();

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

async function seedRequest(userId: string) {
  const requestId = crypto.randomUUID();
  const teamId = `team-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("play_cricket_team")
    .values({
      id: teamId,
      site_id: "9999",
      name: "Test 1st XI",
    })
    .execute();
  await ctx.db
    .insertInto("availability_request")
    .values({
      id: requestId,
      created_by: userId,
      date_from: "2026-06-01",
      date_to: "2026-06-30",
      status: "open",
    })
    .execute();
  await ctx.db
    .insertInto("availability_fixture")
    .values({
      id: crypto.randomUUID(),
      availability_request_id: requestId,
      match_date: "2026-06-07",
      play_cricket_match_id: `pc-${crypto.randomUUID()}`,
      play_cricket_team_id: teamId,
      opposition: "Test CC",
      is_home: true,
      competition_name: null,
      competition_type: null,
      match_time: "13:00",
    })
    .execute();
  return requestId;
}

describe("sendAvailabilityNotification channel routing", () => {
  it("sends email-only when preference is 'email' (default)", async () => {
    const { userId, email } = await seedTestUser(ctx.db, { withMember: false });
    const requestId = await seedRequest(userId);

    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const sendPush: SendPush = vi.fn();

    const result = await sendAvailabilityNotification(
      ctx.db,
      sendEmail,
      sendPush,
      "https://example.com",
    )(requestId, { recipients: [{ email, name: "Test" }] }, log);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendPush).not.toHaveBeenCalled();
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("sends push-only when preference is 'push' and a subscription exists", async () => {
    const { userId, email } = await seedTestUser(ctx.db, { withMember: false });
    await upsertNotificationPreferences(ctx.db)(userId, {
      matchdayChannel: "push",
    });
    await upsertPushSubscription(ctx.db)(userId, {
      endpoint: "https://push.example/u1",
      keys: { p256dh: "p", auth: "a" },
    });
    const requestId = await seedRequest(userId);

    const sendEmail = vi.fn();
    const sendPush: SendPush = vi.fn(
      (sub: PushSubscriptionInput): Promise<SendPushResult> =>
        Promise.resolve({ ok: true, endpoint: sub.endpoint }),
    );

    const result = await sendAvailabilityNotification(
      ctx.db,
      sendEmail,
      sendPush,
      "https://example.com",
    )(requestId, { recipients: [{ email, name: "Test" }] }, log);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });

  it("falls back to email when preference is 'push' but no subscriptions exist", async () => {
    const { userId, email } = await seedTestUser(ctx.db, { withMember: false });
    await upsertNotificationPreferences(ctx.db)(userId, {
      matchdayChannel: "push",
    });
    const requestId = await seedRequest(userId);

    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const sendPush: SendPush = vi.fn();

    const result = await sendAvailabilityNotification(
      ctx.db,
      sendEmail,
      sendPush,
      "https://example.com",
    )(requestId, { recipients: [{ email, name: "Test" }] }, log);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendPush).not.toHaveBeenCalled();
    expect(result.sent).toBe(1);
  });

  it("sends both when preference is 'both' and a subscription exists", async () => {
    const { userId, email } = await seedTestUser(ctx.db, { withMember: false });
    await upsertNotificationPreferences(ctx.db)(userId, {
      matchdayChannel: "both",
    });
    await upsertPushSubscription(ctx.db)(userId, {
      endpoint: "https://push.example/u2",
      keys: { p256dh: "p", auth: "a" },
    });
    const requestId = await seedRequest(userId);

    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const sendPush: SendPush = vi.fn(
      (sub: PushSubscriptionInput): Promise<SendPushResult> =>
        Promise.resolve({ ok: true, endpoint: sub.endpoint }),
    );

    const result = await sendAvailabilityNotification(
      ctx.db,
      sendEmail,
      sendPush,
      "https://example.com",
    )(requestId, { recipients: [{ email, name: "Test" }] }, log);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });

  it("prunes a subscription that returns gone (410)", async () => {
    const { userId, email } = await seedTestUser(ctx.db, { withMember: false });
    await upsertNotificationPreferences(ctx.db)(userId, {
      matchdayChannel: "push",
    });
    const endpoint = "https://push.example/gone";
    await upsertPushSubscription(ctx.db)(userId, {
      endpoint,
      keys: { p256dh: "p", auth: "a" },
    });
    // Add a second live sub so the recipient is still considered delivered.
    await upsertPushSubscription(ctx.db)(userId, {
      endpoint: "https://push.example/live",
      keys: { p256dh: "p", auth: "a" },
    });
    const requestId = await seedRequest(userId);

    const sendEmail = vi.fn();
    const sendPush: SendPush = vi.fn(
      (sub: PushSubscriptionInput): Promise<SendPushResult> => {
        if (sub.endpoint === endpoint) {
          return Promise.resolve({
            ok: false,
            endpoint,
            gone: true,
            reason: "Gone",
          });
        }
        return Promise.resolve({ ok: true, endpoint: sub.endpoint });
      },
    );

    await sendAvailabilityNotification(
      ctx.db,
      sendEmail,
      sendPush,
      "https://example.com",
    )(requestId, { recipients: [{ email, name: "Test" }] }, log);

    const remaining = await ctx.db
      .selectFrom("push_subscription")
      .selectAll()
      .where("user_id", "=", userId)
      .execute();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.endpoint).toBe("https://push.example/live");
  });

  it("falls back to email for additional emails that have no matching user", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    const requestId = await seedRequest(userId);

    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const sendPush: SendPush = vi.fn();

    const result = await sendAvailabilityNotification(
      ctx.db,
      sendEmail,
      sendPush,
      "https://example.com",
    )(
      requestId,
      { recipients: [{ email: "external@example.com", name: null }] },
      log,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendPush).not.toHaveBeenCalled();
    expect(result.sent).toBe(1);
  });
});
