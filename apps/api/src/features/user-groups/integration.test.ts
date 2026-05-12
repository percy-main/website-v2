import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  addGroupMembers,
  createGroup,
  getGroup,
  listAvailableMembers,
  listGroups,
  removeGroupMember,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 60_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("user groups service", () => {
  it("creates a group and lists it with zero members", async () => {
    const { userId } = await seedTestUser(ctx.db);

    const { id } = await createGroup(ctx.db)(userId, {
      name: "Senior players",
      description: "Anyone available for senior cricket",
    });

    expect(id).toBeTruthy();

    const { groups } = await listGroups(ctx.db)();
    const found = groups.find((g) => g.id === id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("Senior players");
    expect(found?.description).toBe("Anyone available for senior cricket");
    expect(found?.memberCount).toBe(0);
  });

  it("rejects duplicate group names with 409", async () => {
    const { userId } = await seedTestUser(ctx.db);
    await createGroup(ctx.db)(userId, { name: "Womens players" });

    await expect(
      createGroup(ctx.db)(userId, { name: "Womens players" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("bulk-adds and removes members; counts update", async () => {
    const { userId } = await seedTestUser(ctx.db);
    const alice = await seedTestUser(ctx.db, { withMember: true });
    const bob = await seedTestUser(ctx.db, { withMember: true });
    if (!alice.memberId || !bob.memberId) throw new Error("expected members");

    const { id: groupId } = await createGroup(ctx.db)(userId, {
      name: "Sunday XI",
    });

    const result = await addGroupMembers(ctx.db)(
      groupId,
      { memberIds: [alice.memberId, bob.memberId] },
      userId,
    );
    expect(result.added).toBe(2);

    const detail = await getGroup(ctx.db)(groupId);
    expect(detail.members).toHaveLength(2);

    const { groups } = await listGroups(ctx.db)();
    expect(groups.find((g) => g.id === groupId)?.memberCount).toBe(2);

    // Re-adding the same members is idempotent (no rows inserted).
    const again = await addGroupMembers(ctx.db)(
      groupId,
      { memberIds: [alice.memberId] },
      userId,
    );
    expect(again.added).toBe(0);
    const after = await getGroup(ctx.db)(groupId);
    expect(after.members).toHaveLength(2);

    await removeGroupMember(ctx.db)(groupId, alice.memberId);
    const removed = await getGroup(ctx.db)(groupId);
    expect(removed.members).toHaveLength(1);
    expect(removed.members[0]?.memberId).toBe(bob.memberId);
  });

  it("listAvailableMembers excludes members already in the group", async () => {
    const { userId } = await seedTestUser(ctx.db);
    const inGroup = await seedTestUser(ctx.db, {
      name: "Jane Bowler",
      email: `jane-bowler-${crypto.randomUUID()}@test.com`,
    });
    const outOfGroup = await seedTestUser(ctx.db, {
      name: "Jane Batter",
      email: `jane-batter-${crypto.randomUUID()}@test.com`,
    });
    if (!inGroup.memberId || !outOfGroup.memberId) {
      throw new Error("expected members");
    }

    const { id: groupId } = await createGroup(ctx.db)(userId, {
      name: "First XI",
    });
    await addGroupMembers(ctx.db)(
      groupId,
      { memberIds: [inGroup.memberId] },
      userId,
    );

    const { members } = await listAvailableMembers(ctx.db)(groupId);
    const ids = members.map((m) => m.memberId);
    expect(ids).toContain(outOfGroup.memberId);
    expect(ids).not.toContain(inGroup.memberId);
  });

  it("addGroupMembers rejects unknown member ids with 404", async () => {
    const { userId } = await seedTestUser(ctx.db);
    const { id: groupId } = await createGroup(ctx.db)(userId, {
      name: "Reject XI",
    });
    await expect(
      addGroupMembers(ctx.db)(
        groupId,
        { memberIds: ["does-not-exist"] },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("404s for unknown group on get / addMembers / listAvailable", async () => {
    await expect(getGroup(ctx.db)("missing")).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      addGroupMembers(ctx.db)("missing", { memberIds: ["x"] }, "u"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(listAvailableMembers(ctx.db)("missing")).rejects.toMatchObject(
      { statusCode: 404 },
    );
  });
});
