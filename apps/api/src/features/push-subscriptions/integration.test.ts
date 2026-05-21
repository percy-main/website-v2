import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsForUsers,
  upsertPushSubscription,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

const SUB_A = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "p256dh-A", auth: "auth-A" },
  userAgent: "Chrome/Mac",
};
const SUB_B = {
  endpoint: "https://push.example.com/def",
  keys: { p256dh: "p256dh-B", auth: "auth-B" },
};

describe("push-subscriptions service (integration)", () => {
  it("creates a subscription and returns an id", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    const result = await upsertPushSubscription(ctx.db)(userId, SUB_A);
    expect(result.id).toBeDefined();

    const rows = await ctx.db
      .selectFrom("push_subscription")
      .selectAll()
      .where("user_id", "=", userId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(SUB_A.endpoint);
    expect(rows[0]?.p256dh).toBe(SUB_A.keys.p256dh);
    expect(rows[0]?.user_agent).toBe("Chrome/Mac");
  });

  it("updates an existing subscription on conflicting endpoint", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    await upsertPushSubscription(ctx.db)(userId, SUB_A);
    await upsertPushSubscription(ctx.db)(userId, {
      ...SUB_A,
      keys: { p256dh: "rotated", auth: "rotated" },
    });

    const rows = await ctx.db
      .selectFrom("push_subscription")
      .selectAll()
      .where("user_id", "=", userId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe("rotated");
  });

  it("re-keys a subscription onto a different user when the device is shared", async () => {
    const a = await seedTestUser(ctx.db, { withMember: false });
    const b = await seedTestUser(ctx.db, { withMember: false });
    await upsertPushSubscription(ctx.db)(a.userId, SUB_A);
    await upsertPushSubscription(ctx.db)(b.userId, SUB_A);

    const aRows = await ctx.db
      .selectFrom("push_subscription")
      .where("user_id", "=", a.userId)
      .selectAll()
      .execute();
    const bRows = await ctx.db
      .selectFrom("push_subscription")
      .where("user_id", "=", b.userId)
      .selectAll()
      .execute();
    expect(aRows).toHaveLength(0);
    expect(bRows).toHaveLength(1);
  });

  it("deletes only the caller's own subscription", async () => {
    const a = await seedTestUser(ctx.db, { withMember: false });
    const b = await seedTestUser(ctx.db, { withMember: false });
    await upsertPushSubscription(ctx.db)(a.userId, SUB_A);
    await upsertPushSubscription(ctx.db)(b.userId, SUB_B);

    const fromOtherUser = await deletePushSubscription(ctx.db)(
      b.userId,
      SUB_A.endpoint,
    );
    expect(fromOtherUser.deleted).toBe(false);

    const own = await deletePushSubscription(ctx.db)(a.userId, SUB_A.endpoint);
    expect(own.deleted).toBe(true);
  });

  it("lists subscriptions grouped by user", async () => {
    const a = await seedTestUser(ctx.db, { withMember: false });
    const b = await seedTestUser(ctx.db, { withMember: false });
    await upsertPushSubscription(ctx.db)(a.userId, SUB_A);
    await upsertPushSubscription(ctx.db)(b.userId, SUB_B);

    const map = await listPushSubscriptionsForUsers(ctx.db)([
      a.userId,
      b.userId,
    ]);
    expect(map.get(a.userId)).toHaveLength(1);
    expect(map.get(b.userId)).toHaveLength(1);
    expect(map.get(a.userId)?.[0]?.endpoint).toBe(SUB_A.endpoint);
  });

  it("hard-deletes a subscription by endpoint (gone-410 cleanup)", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    await upsertPushSubscription(ctx.db)(userId, SUB_A);
    await deletePushSubscriptionByEndpoint(ctx.db)(SUB_A.endpoint);
    const rows = await ctx.db
      .selectFrom("push_subscription")
      .selectAll()
      .where("endpoint", "=", SUB_A.endpoint)
      .execute();
    expect(rows).toHaveLength(0);
  });
});
