import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  addGroupMember,
  createGroup,
  getGroup,
  listGroups,
  removeGroupMember,
  searchUsersForGroup,
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

  it("adds and removes members; counts update", async () => {
    const { userId } = await seedTestUser(ctx.db);
    const player = await seedTestUser(ctx.db, { withMember: true });
    if (!player.memberId) throw new Error("expected member");

    const { id: groupId } = await createGroup(ctx.db)(userId, {
      name: "Sunday XI",
    });

    await addGroupMember(ctx.db)(
      groupId,
      { memberId: player.memberId },
      userId,
    );

    const detail = await getGroup(ctx.db)(groupId);
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]?.memberId).toBe(player.memberId);
    expect(detail.members[0]?.email).toBe(player.email);

    const { groups } = await listGroups(ctx.db)();
    expect(groups.find((g) => g.id === groupId)?.memberCount).toBe(1);

    // Adding the same member again is a no-op (idempotent).
    await addGroupMember(ctx.db)(
      groupId,
      { memberId: player.memberId },
      userId,
    );
    const after = await getGroup(ctx.db)(groupId);
    expect(after.members).toHaveLength(1);

    await removeGroupMember(ctx.db)(groupId, player.memberId);
    const removed = await getGroup(ctx.db)(groupId);
    expect(removed.members).toHaveLength(0);
  });

  it("search excludes users already in the group", async () => {
    const { userId } = await seedTestUser(ctx.db);
    const inGroup = await seedTestUser(ctx.db, {
      name: "Jane Bowler",
      email: "jane.bowler@test.com",
    });
    const outOfGroup = await seedTestUser(ctx.db, {
      name: "Jane Batter",
      email: "jane.batter@test.com",
    });
    if (!inGroup.memberId || !outOfGroup.memberId) {
      throw new Error("expected members");
    }

    const { id: groupId } = await createGroup(ctx.db)(userId, {
      name: "First XI",
    });
    await addGroupMember(ctx.db)(
      groupId,
      { memberId: inGroup.memberId },
      userId,
    );

    const { users } = await searchUsersForGroup(ctx.db)(groupId, { q: "jane" });
    const memberIds = users.map((u) => u.memberId);
    expect(memberIds).toContain(outOfGroup.memberId);
    expect(memberIds).not.toContain(inGroup.memberId);
  });

  it("search with empty query returns no users", async () => {
    const { userId } = await seedTestUser(ctx.db);
    const { id: groupId } = await createGroup(ctx.db)(userId, {
      name: "Empty search group",
    });

    const result = await searchUsersForGroup(ctx.db)(groupId, { q: "" });
    expect(result.users).toEqual([]);
  });

  it("get / addMember / search throw 404 for unknown group", async () => {
    await expect(getGroup(ctx.db)("missing")).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      addGroupMember(ctx.db)("missing", { memberId: "x" }, "u"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      searchUsersForGroup(ctx.db)("missing", { q: "anything" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
