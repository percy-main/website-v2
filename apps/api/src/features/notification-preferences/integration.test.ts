import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  getNotificationPreferences,
  getNotificationPreferencesByUserIds,
  upsertNotificationPreferences,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("notification-preferences service (integration)", () => {
  it("returns 'email' by default for a user with no row", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    const prefs = await getNotificationPreferences(ctx.db)(userId);
    expect(prefs.matchdayChannel).toBe("email");
  });

  it("upserts a fresh preference row", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    const result = await upsertNotificationPreferences(ctx.db)(userId, {
      matchdayChannel: "push",
    });
    expect(result.matchdayChannel).toBe("push");

    const reread = await getNotificationPreferences(ctx.db)(userId);
    expect(reread.matchdayChannel).toBe("push");
  });

  it("updates the existing row on subsequent upsert", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    await upsertNotificationPreferences(ctx.db)(userId, {
      matchdayChannel: "push",
    });
    await upsertNotificationPreferences(ctx.db)(userId, {
      matchdayChannel: "both",
    });
    const reread = await getNotificationPreferences(ctx.db)(userId);
    expect(reread.matchdayChannel).toBe("both");
  });

  it("batches preference reads by user id", async () => {
    const a = await seedTestUser(ctx.db, { withMember: false });
    const b = await seedTestUser(ctx.db, { withMember: false });
    await upsertNotificationPreferences(ctx.db)(a.userId, {
      matchdayChannel: "push",
    });
    await upsertNotificationPreferences(ctx.db)(b.userId, {
      matchdayChannel: "both",
    });
    const map = await getNotificationPreferencesByUserIds(ctx.db)([
      a.userId,
      b.userId,
    ]);
    expect(map.get(a.userId)).toBe("push");
    expect(map.get(b.userId)).toBe("both");
  });
});
