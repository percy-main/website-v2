import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  assignPlayer,
  confirmDate,
  confirmFixture,
  getActiveRequests,
  getDateDetail,
  getRequest,
  listRequests,
  removeAssignment,
  respond,
  setAvailability,
  setDependentAvailability,
  updateRequestStatus,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

/** Seed a play_cricket_team row. */
async function seedTeam(name: string, isJunior = false) {
  const teamId = `pct-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("play_cricket_team")
    .values({
      id: teamId,
      name,
      site_id: "site-1",
      is_junior: isJunior,
    })
    .execute();
  return teamId;
}

/** Seed a member row. */
async function seedMember(name: string, email: string) {
  const id = `mem-${crypto.randomUUID()}`;
  await ctx.db.insertInto("member").values({ id, name, email }).execute();
  return id;
}

/** Seed a dependent (junior) registered under a parent member. */
async function seedDependent(memberId: string, name: string) {
  const id = `dep-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("dependent")
    .values({ id, member_id: memberId, name, sex: "male", dob: "2013-05-01" })
    .execute();
  return id;
}

/** Create an availability request directly in the DB (bypasses API call). */
async function seedRequest(
  userId: string,
  dateFrom: string,
  dateTo: string,
  status = "open",
  userGroupId: string | null = null,
) {
  const id = `req-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("availability_request")
    .values({
      id,
      created_by: userId,
      date_from: dateFrom,
      date_to: dateTo,
      status,
    })
    .execute();
  if (userGroupId) {
    await ctx.db
      .insertInto("availability_request_group")
      .values({ request_id: id, user_group_id: userGroupId })
      .execute();
  }
  return id;
}

/** Seed a user_group row and optionally add members to it. */
async function seedGroup(name: string, memberIds: readonly string[] = []) {
  const id = `grp-${crypto.randomUUID()}`;
  await ctx.db.insertInto("user_group").values({ id, name }).execute();
  if (memberIds.length > 0) {
    await ctx.db
      .insertInto("user_group_member")
      .values(
        memberIds.map((memberId) => ({ group_id: id, member_id: memberId })),
      )
      .execute();
  }
  return id;
}

/** Grant an official access to a team (team_official join row). */
async function seedTeamOfficial(userId: string, teamId: string) {
  await ctx.db
    .insertInto("team_official")
    .values({ user_id: userId, play_cricket_team_id: teamId })
    .execute();
}

/** Seed a fixture for a request. */
async function seedFixture(
  requestId: string,
  teamId: string,
  matchDate: string,
  opposition = "Opposition CC",
) {
  const id = `fix-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("availability_fixture")
    .values({
      id,
      availability_request_id: requestId,
      match_date: matchDate,
      play_cricket_match_id: `pcm-${crypto.randomUUID()}`,
      play_cricket_team_id: teamId,
      opposition,
      is_home: true,
    })
    .execute();
  return id;
}

describe("availability service (integration)", () => {
  describe("listRequests", () => {
    it("returns empty list initially", async () => {
      const result = await listRequests(ctx.db)("system", "admin", {
        limit: 20,
        offset: 0,
      });
      expect(result.items).toEqual([]);
    });

    it("returns requests with counts", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `list-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("1st XI");
      const reqId = await seedRequest(userId, "2026-06-01", "2026-06-07");
      await seedFixture(reqId, teamId, "2026-06-01");
      await seedFixture(reqId, teamId, "2026-06-07");

      const result = await listRequests(ctx.db)(userId, "admin", {
        limit: 20,
        offset: 0,
      });
      const req = result.items.find((r) => r.id === reqId);
      expect(req).toBeDefined();
      expect(req?.fixtureCount).toBe(2);
      expect(req?.respondentCount).toBe(0);
    });
  });

  describe("getRequest", () => {
    it("returns request with dates grouped", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `get-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("2nd XI");
      const reqId = await seedRequest(userId, "2026-07-01", "2026-07-08");
      await seedFixture(reqId, teamId, "2026-07-01", "Team A");
      await seedFixture(reqId, teamId, "2026-07-05", "Team B");

      const result = await getRequest(ctx.db)(userId, "admin", reqId);
      expect(result.request.id).toBe(reqId);
      expect(result.dates).toHaveLength(2);
      expect(result.dates[0].date).toBe("2026-07-01");
      expect(result.dates[1].date).toBe("2026-07-05");
    });

    it("throws 404 for non-existent request", async () => {
      await expect(
        getRequest(ctx.db)("system", "admin", "nonexistent"),
      ).rejects.toThrow("not found");
    });
  });

  describe("getDateDetail + assignPlayer", () => {
    it("returns fixture details and player pools", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `detail-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("3rd XI");

      // Seed some members
      const memberId1 = await seedMember(
        "Alice",
        `alice-${crypto.randomUUID()}@test.com`,
      );
      const memberId2 = await seedMember(
        "Bob",
        `bob-${crypto.randomUUID()}@test.com`,
      );
      const memberId3 = await seedMember(
        "Carol",
        `carol-${crypto.randomUUID()}@test.com`,
      );

      // The request scopes its no-response pool to its user groups; put
      // all three members in one group so Carol surfaces as no-response.
      const groupId = await seedGroup("3rd XI group", [
        memberId1,
        memberId2,
        memberId3,
      ]);
      const reqId = await seedRequest(
        userId,
        "2026-08-01",
        "2026-08-07",
        "open",
        groupId,
      );
      const fixId = await seedFixture(reqId, teamId, "2026-08-01");

      // Alice responds available
      await ctx.db
        .insertInto("availability_response")
        .values({
          id: crypto.randomUUID(),
          availability_request_id: reqId,
          member_id: memberId1,
          match_date: "2026-08-01",
          status: "available",
          note: "Free all day",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      // Bob responds unavailable
      await ctx.db
        .insertInto("availability_response")
        .values({
          id: crypto.randomUUID(),
          availability_request_id: reqId,
          member_id: memberId2,
          match_date: "2026-08-01",
          status: "unavailable",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      const result = await getDateDetail(ctx.db)(
        userId,
        "admin",
        reqId,
        "2026-08-01",
      );
      expect(result.fixtures).toHaveLength(1);
      expect(result.fixtures[0].id).toBe(fixId);
      expect(result.pools.available).toHaveLength(1);
      expect(result.pools.available[0].member_name).toBe("Alice");
      expect(result.pools.unavailable).toHaveLength(1);
      expect(result.pools.unavailable[0].member_name).toBe("Bob");
      expect(result.pools.noResponse.length).toBeGreaterThan(0);
    });

    it("assigns and removes players", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `assign-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Saturday XI");
      const reqId = await seedRequest(userId, "2026-09-01", "2026-09-07");
      const fixId = await seedFixture(reqId, teamId, "2026-09-01");
      const memberId = await seedMember(
        "Charlie",
        `charlie-${crypto.randomUUID()}@test.com`,
      );

      // Assign player
      const { id: assignId, position } = await assignPlayer(ctx.db)(
        userId,
        "admin",
        reqId,
        "2026-09-01",
        {
          fixtureId: fixId,
          memberId,
          playerName: "Charlie",
        },
      );
      expect(assignId).toBeDefined();
      expect(position).toBe(1);

      // Verify shows in date detail
      const detail = await getDateDetail(ctx.db)(
        userId,
        "admin",
        reqId,
        "2026-09-01",
      );
      expect(detail.fixtures[0].assignments).toHaveLength(1);
      expect(detail.fixtures[0].assignments[0].player_name).toBe("Charlie");

      // Duplicate assignment should fail
      await expect(
        assignPlayer(ctx.db)(userId, "admin", reqId, "2026-09-01", {
          fixtureId: fixId,
          memberId,
          playerName: "Charlie",
        }),
      ).rejects.toThrow("already assigned");

      // Remove assignment
      const removeResult = await removeAssignment(ctx.db)(
        userId,
        "admin",
        assignId,
      );
      expect(removeResult.success).toBe(true);
    });

    it("supports non-member (guest) assignments", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `guest-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Guest XI");
      const reqId = await seedRequest(userId, "2026-10-01", "2026-10-07");
      const fixId = await seedFixture(reqId, teamId, "2026-10-01");

      const { id: assignId } = await assignPlayer(ctx.db)(
        userId,
        "admin",
        reqId,
        "2026-10-01",
        {
          fixtureId: fixId,
          playerName: "Guest Player",
        },
      );
      expect(assignId).toBeDefined();

      const detail = await getDateDetail(ctx.db)(
        userId,
        "admin",
        reqId,
        "2026-10-01",
      );
      const assignment = detail.fixtures[0].assignments[0];
      expect(assignment.player_name).toBe("Guest Player");
      expect(assignment.member_id).toBeNull();
    });
  });

  describe("setAvailability", () => {
    it("overrides an existing player response", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `override-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Override XI");
      const reqId = await seedRequest(userId, "2026-11-01", "2026-11-07");
      await seedFixture(reqId, teamId, "2026-11-01");
      const memberId = await seedMember(
        "Dave",
        `dave-${crypto.randomUUID()}@test.com`,
      );

      // Dave says unavailable
      await ctx.db
        .insertInto("availability_response")
        .values({
          id: crypto.randomUUID(),
          availability_request_id: reqId,
          member_id: memberId,
          match_date: "2026-11-01",
          status: "unavailable",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      // Official overrides to available
      const result = await setAvailability(ctx.db)(
        userId,
        "admin",
        reqId,
        "2026-11-01",
        memberId,
        { status: "available" },
      );
      expect(result.success).toBe(true);

      const updated = await ctx.db
        .selectFrom("availability_response")
        .where("availability_request_id", "=", reqId)
        .where("member_id", "=", memberId)
        .where("match_date", "=", "2026-11-01")
        .selectAll()
        .executeTakeFirst();
      expect(updated).toBeDefined();
      expect(updated?.status).toBe("available");
      expect(updated?.overridden_by).toBe(userId);
    });

    it("creates a response for a member who hasn't responded", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `setavail-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("SetAvail XI");
      const reqId = await seedRequest(userId, "2026-11-08", "2026-11-14");
      await seedFixture(reqId, teamId, "2026-11-08");
      const memberId = await seedMember(
        "Eve",
        `eve-${crypto.randomUUID()}@test.com`,
      );

      const result = await setAvailability(ctx.db)(
        userId,
        "admin",
        reqId,
        "2026-11-08",
        memberId,
        { status: "available" },
      );
      expect(result.success).toBe(true);

      const created = await ctx.db
        .selectFrom("availability_response")
        .where("availability_request_id", "=", reqId)
        .where("member_id", "=", memberId)
        .where("match_date", "=", "2026-11-08")
        .selectAll()
        .executeTakeFirst();
      expect(created).toBeDefined();
      expect(created?.status).toBe("available");
      expect(created?.overridden_by).toBe(userId);
    });

    it("404s when there's no fixture on the date", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `setavail-nofix-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("NoFix XI");
      const reqId = await seedRequest(userId, "2026-11-15", "2026-11-21");
      await seedFixture(reqId, teamId, "2026-11-15");
      const memberId = await seedMember(
        "Frank",
        `frank-${crypto.randomUUID()}@test.com`,
      );

      await expect(
        setAvailability(ctx.db)(
          userId,
          "admin",
          reqId,
          "2026-11-20",
          memberId,
          {
            status: "available",
          },
        ),
      ).rejects.toThrow("No fixtures");
    });
  });

  describe("respond (member flow)", () => {
    it("member can respond to a request", async () => {
      const email = `member-respond-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, {
        email,
        role: "user",
        withMember: true,
      });

      const adminUser = await seedTestUser(ctx.db, {
        email: `admin-respond-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Respond XI");
      const reqId = await seedRequest(
        adminUser.userId,
        "2026-12-01",
        "2026-12-07",
      );
      await seedFixture(reqId, teamId, "2026-12-01");
      await seedFixture(reqId, teamId, "2026-12-05");

      // Respond available for one date, unavailable for another
      const result = await respond(ctx.db)(email, reqId, {
        responses: [
          { matchDate: "2026-12-01", status: "available", note: "Free" },
          { matchDate: "2026-12-05", status: "unavailable" },
        ],
      });
      expect(result.success).toBe(true);

      // Verify responses
      expect(memberId).toBeDefined();
      const responses = await ctx.db
        .selectFrom("availability_response")
        .where("member_id", "=", memberId ?? "")
        .where("availability_request_id", "=", reqId)
        .selectAll()
        .execute();
      expect(responses).toHaveLength(2);

      const dec1 = responses.find((r) => r.match_date === "2026-12-01");
      expect(dec1).toBeDefined();
      expect(dec1?.status).toBe("available");
      expect(dec1?.note).toBe("Free");

      const dec5 = responses.find((r) => r.match_date === "2026-12-05");
      expect(dec5).toBeDefined();
      expect(dec5?.status).toBe("unavailable");
    });

    it("member can update their response", async () => {
      const email = `update-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email, withMember: true });

      const adminUser = await seedTestUser(ctx.db, {
        email: `admin-update-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Update XI");
      const reqId = await seedRequest(
        adminUser.userId,
        "2027-01-01",
        "2027-01-07",
      );
      await seedFixture(reqId, teamId, "2027-01-01");

      // First response: unavailable
      await respond(ctx.db)(email, reqId, {
        responses: [{ matchDate: "2027-01-01", status: "unavailable" }],
      });

      // Update to available
      await respond(ctx.db)(email, reqId, {
        responses: [
          {
            matchDate: "2027-01-01",
            status: "available",
            note: "Plans changed",
          },
        ],
      });

      // Should still be 1 response (upserted)
      const responses = await ctx.db
        .selectFrom("availability_response")
        .where("availability_request_id", "=", reqId)
        .selectAll()
        .execute();
      expect(responses).toHaveLength(1);
      expect(responses[0].status).toBe("available");
      expect(responses[0].note).toBe("Plans changed");
    });
  });

  describe("getActiveRequests (member flow)", () => {
    it("returns open requests with fixtures and member responses", async () => {
      const email = `active-${crypto.randomUUID()}@test.com`;
      const seeded = await seedTestUser(ctx.db, { email, withMember: true });
      if (!seeded.memberId) throw new Error("expected member to be seeded");

      const adminUser = await seedTestUser(ctx.db, {
        email: `admin-active-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Active XI");
      const groupId = await seedGroup("Active group", [seeded.memberId]);
      const reqId = await seedRequest(
        adminUser.userId,
        "2027-02-01",
        "2027-02-07",
        "open",
        groupId,
      );
      await seedFixture(reqId, teamId, "2027-02-01");

      // Respond
      await respond(ctx.db)(email, reqId, {
        responses: [{ matchDate: "2027-02-01", status: "available" }],
      });

      const result = await getActiveRequests(ctx.db)(email);
      const req = result.items.find((r) => r.id === reqId);
      expect(req).toBeDefined();
      expect(req?.fixtures.length).toBeGreaterThanOrEqual(1);
      expect(req?.myResponses).toHaveLength(1);
      expect(req?.myResponses[0].status).toBe("available");
    });
  });

  describe("dependent flow (juniors playing up)", () => {
    it("a parent can respond on behalf of their dependent", async () => {
      const email = `parent-${crypto.randomUUID()}@test.com`;
      const parentId = await seedMember("Parent One", email);
      const depId = await seedDependent(parentId, "Junior One");

      const admin = await seedTestUser(ctx.db, {
        email: `admin-dep-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Senior XI");
      const groupId = await seedGroup("Senior group", [parentId]);
      const reqId = await seedRequest(
        admin.userId,
        "2027-07-01",
        "2027-07-01",
        "open",
        groupId,
      );
      await seedFixture(reqId, teamId, "2027-07-01");

      await respond(ctx.db)(email, reqId, {
        subjectDependentId: depId,
        responses: [{ matchDate: "2027-07-01", status: "available" }],
      });

      // Stored against the dependent, not the parent member.
      const row = await ctx.db
        .selectFrom("availability_response")
        .where("availability_request_id", "=", reqId)
        .where("dependent_id", "=", depId)
        .select(["member_id", "dependent_id", "status"])
        .executeTakeFirst();
      expect(row?.member_id).toBeNull();
      expect(row?.dependent_id).toBe(depId);
      expect(row?.status).toBe("available");

      // Surfaced back through the active feed for the wizard to pre-fill.
      const active = await getActiveRequests(ctx.db)(email);
      expect(active.dependents.map((d) => d.id)).toContain(depId);
      const item = active.items.find((r) => r.id === reqId);
      expect(item?.dependentResponses).toContainEqual(
        expect.objectContaining({
          dependent_id: depId,
          match_date: "2027-07-01",
          status: "available",
        }),
      );
    });

    it("rejects responding for a dependent that isn't the member's", async () => {
      const parentEmail = `parent-a-${crypto.randomUUID()}@test.com`;
      await seedMember("Parent A", parentEmail);

      const otherParentId = await seedMember(
        "Parent B",
        `parent-b-${crypto.randomUUID()}@test.com`,
      );
      const otherDepId = await seedDependent(otherParentId, "Not Yours");

      const admin = await seedTestUser(ctx.db, {
        email: `admin-own-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Own XI");
      const reqId = await seedRequest(
        admin.userId,
        "2027-07-08",
        "2027-07-08",
        "open",
      );
      await seedFixture(reqId, teamId, "2027-07-08");

      await expect(
        respond(ctx.db)(parentEmail, reqId, {
          subjectDependentId: otherDepId,
          responses: [{ matchDate: "2027-07-08", status: "available" }],
        }),
      ).rejects.toThrow("not registered under your account");
    });

    it("surfaces an available dependent in the picker and materialises them into the matchday", async () => {
      const email = `parent-pick-${crypto.randomUUID()}@test.com`;
      const parentId = await seedMember("Parent Pick", email);
      const depId = await seedDependent(parentId, "Junior Pick");

      const admin = await seedTestUser(ctx.db, {
        email: `admin-pick-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Pick XI");
      const groupId = await seedGroup("Pick group", [parentId]);
      const reqId = await seedRequest(
        admin.userId,
        "2027-07-15",
        "2027-07-15",
        "open",
        groupId,
      );
      const fixtureId = await seedFixture(reqId, teamId, "2027-07-15");

      await respond(ctx.db)(email, reqId, {
        subjectDependentId: depId,
        responses: [{ matchDate: "2027-07-15", status: "available" }],
      });

      const detail = await getDateDetail(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-07-15",
      );
      const availableDep = detail.pools.available.find(
        (r) => r.dependent_id === depId,
      );
      expect(availableDep?.member_name).toBe("Junior Pick");
      expect(availableDep?.member_id).toBeNull();

      // Pick the junior into the senior fixture.
      await assignPlayer(ctx.db)(admin.userId, "admin", reqId, "2027-07-15", {
        fixtureId,
        dependentId: depId,
        playerName: "Junior Pick",
      });

      // Duplicate assignment of the same dependent is rejected.
      await expect(
        assignPlayer(ctx.db)(admin.userId, "admin", reqId, "2027-07-15", {
          fixtureId,
          dependentId: depId,
          playerName: "Junior Pick",
        }),
      ).rejects.toThrow("already assigned");

      const afterAssign = await getDateDetail(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-07-15",
      );
      expect(afterAssign.assignedDependentIds).toContain(depId);

      // Closing the request materialises the dependent into matchday_player.
      await updateRequestStatus(ctx.db)(admin.userId, "admin", reqId, {
        status: "closed",
      });
      const player = await ctx.db
        .selectFrom("matchday_player")
        .innerJoin("matchday", "matchday.id", "matchday_player.matchday_id")
        .where("matchday.play_cricket_team_id", "=", teamId)
        .where("matchday.match_date", "=", "2027-07-15")
        .where("matchday_player.dependent_id", "=", depId)
        .select(["matchday_player.dependent_id", "matchday_player.member_id"])
        .executeTakeFirst();
      expect(player?.dependent_id).toBe(depId);
      expect(player?.member_id).toBeNull();
    });

    it("an official can override a dependent's availability", async () => {
      const email = `parent-ovr-${crypto.randomUUID()}@test.com`;
      const parentId = await seedMember("Parent Ovr", email);
      const depId = await seedDependent(parentId, "Junior Ovr");

      const admin = await seedTestUser(ctx.db, {
        email: `admin-ovr-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Ovr XI");
      const groupId = await seedGroup("Ovr group", [parentId]);
      const reqId = await seedRequest(
        admin.userId,
        "2027-08-01",
        "2027-08-01",
        "open",
        groupId,
      );
      await seedFixture(reqId, teamId, "2027-08-01");

      // Parent says available; official overrides to unavailable.
      await respond(ctx.db)(email, reqId, {
        subjectDependentId: depId,
        responses: [{ matchDate: "2027-08-01", status: "available" }],
      });
      await setDependentAvailability(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-08-01",
        depId,
        { status: "unavailable" },
      );

      const row = await ctx.db
        .selectFrom("availability_response")
        .where("availability_request_id", "=", reqId)
        .where("dependent_id", "=", depId)
        .select(["status", "overridden_by"])
        .executeTakeFirst();
      expect(row?.status).toBe("unavailable");
      expect(row?.overridden_by).toBe(admin.userId);

      const detail = await getDateDetail(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-08-01",
      );
      expect(
        detail.pools.unavailable.some((r) => r.dependent_id === depId),
      ).toBe(true);
    });

    it("won't override a dependent whose parent isn't in the request's groups", async () => {
      // Parent is in no group, so this request never reached them - their
      // child must not be reachable by id.
      const parentId = await seedMember(
        "Parent OOS",
        `parent-oos-${crypto.randomUUID()}@test.com`,
      );
      const depId = await seedDependent(parentId, "Junior OOS");

      const admin = await seedTestUser(ctx.db, {
        email: `admin-oos-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("OOS XI");
      const reqId = await seedRequest(
        admin.userId,
        "2027-08-15",
        "2027-08-15",
        "open",
      );
      await seedFixture(reqId, teamId, "2027-08-15");

      await expect(
        setDependentAvailability(ctx.db)(
          admin.userId,
          "admin",
          reqId,
          "2027-08-15",
          depId,
          { status: "available" },
        ),
      ).rejects.toThrow("not found for this request");
    });

    it("lists an un-answered dependent in the no-response pool and lets an official mark them available", async () => {
      const email = `parent-nr-${crypto.randomUUID()}@test.com`;
      const parentId = await seedMember("Parent NR", email);
      const depId = await seedDependent(parentId, "Junior NR");

      const admin = await seedTestUser(ctx.db, {
        email: `admin-nr-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("NR XI");
      const groupId = await seedGroup("NR group", [parentId]);
      const reqId = await seedRequest(
        admin.userId,
        "2027-09-01",
        "2027-09-01",
        "open",
        groupId,
      );
      await seedFixture(reqId, teamId, "2027-09-01");

      // Nobody has answered - the junior shows up in no-response.
      const before = await getDateDetail(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-09-01",
      );
      expect(
        before.pools.noResponse.some((m) => m.dependent_id === depId),
      ).toBe(true);

      // Official marks the never-answered junior available (creates a row).
      await setDependentAvailability(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-09-01",
        depId,
        { status: "available" },
      );

      const after = await getDateDetail(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-09-01",
      );
      expect(after.pools.available.some((r) => r.dependent_id === depId)).toBe(
        true,
      );
      expect(after.pools.noResponse.some((m) => m.dependent_id === depId)).toBe(
        false,
      );
    });

    it("counts a dependent respondent in the request list", async () => {
      const email = `parent-count-${crypto.randomUUID()}@test.com`;
      const parentId = await seedMember("Parent Count", email);
      const depId = await seedDependent(parentId, "Junior Count");

      const admin = await seedTestUser(ctx.db, {
        email: `admin-count-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Count XI");
      const groupId = await seedGroup("Count group", [parentId]);
      const reqId = await seedRequest(
        admin.userId,
        "2027-08-08",
        "2027-08-08",
        "open",
        groupId,
      );
      await seedFixture(reqId, teamId, "2027-08-08");

      // Only the dependent answers - the parent never responds for self.
      await respond(ctx.db)(email, reqId, {
        subjectDependentId: depId,
        responses: [{ matchDate: "2027-08-08", status: "available" }],
      });

      const result = await listRequests(ctx.db)(admin.userId, "admin", {
        limit: 100,
        offset: 0,
      });
      const req = result.items.find((r) => r.id === reqId);
      expect(req?.respondentCount).toBe(1);
    });
  });

  describe("confirmDate", () => {
    it("creates matchday records from assignments", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `confirm-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Confirm XI");
      const reqId = await seedRequest(userId, "2027-03-01", "2027-03-07");
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-03-01",
        "Confirm Opp CC",
      );
      const memberId = await seedMember(
        "Hank",
        `hank-${crypto.randomUUID()}@test.com`,
      );

      // Assign two players
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-03-01", {
        fixtureId: fixId,
        memberId,
        playerName: "Hank",
      });
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-03-01", {
        fixtureId: fixId,
        playerName: "Guest Player",
      });

      // Confirm
      const result = await confirmDate(ctx.db)(
        userId,
        "admin",
        reqId,
        "2027-03-01",
      );
      expect(result.matchdays).toHaveLength(1);

      const matchdayId = result.matchdays[0].matchdayId;

      // Verify matchday was created
      const matchday = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(matchday).toBeDefined();
      expect(matchday?.play_cricket_team_id).toBe(teamId);
      expect(matchday?.opposition).toBe("Confirm Opp CC");
      expect(matchday?.status).toBe("pending");

      // Verify players were added
      const players = await ctx.db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .selectAll()
        .orderBy("created_at", "asc")
        .execute();
      expect(players).toHaveLength(2);
      expect(players[0].player_name).toBe("Hank");
      expect(players[0].member_id).toBe(memberId);
      expect(players[1].player_name).toBe("Guest Player");
      expect(players[1].member_id).toBeNull();
    });

    it("throws 409 when a matchday already exists for the date", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `conflict-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Conflict XI");
      const reqId = await seedRequest(userId, "2027-08-01", "2027-08-07");
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-08-01",
        "Conflict Opp CC",
      );
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-08-01", {
        fixtureId: fixId,
        playerName: "Guest",
      });

      // First confirmDate succeeds.
      await confirmDate(ctx.db)(userId, "admin", reqId, "2027-08-01");

      // Calling again must conflict rather than silently returning - the
      // captain would otherwise be misled into thinking newly-added picks
      // had been carried into the existing matchday.
      await expect(
        confirmDate(ctx.db)(userId, "admin", reqId, "2027-08-01"),
      ).rejects.toThrow("already exists");
    });
  });

  describe("confirmFixture", () => {
    it("creates a matchday for one fixture and leaves the request open", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cf-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Confirm Fixture XI");
      const reqId = await seedRequest(userId, "2027-05-01", "2027-05-14");
      // Two dates in the same request: confirming the earlier one must not
      // touch the later one, and must leave the request open.
      const earlyFix = await seedFixture(
        reqId,
        teamId,
        "2027-05-01",
        "Early Opp CC",
      );
      const lateFix = await seedFixture(
        reqId,
        teamId,
        "2027-05-08",
        "Late Opp CC",
      );
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-05-01", {
        fixtureId: earlyFix,
        playerName: "Early Player",
      });

      const result = await confirmFixture(ctx.db)(
        userId,
        "admin",
        reqId,
        "2027-05-01",
        earlyFix,
      );

      const matchday = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", result.matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(matchday?.opposition).toBe("Early Opp CC");
      expect(matchday?.status).toBe("pending");

      // Request stays open.
      const request = await ctx.db
        .selectFrom("availability_request")
        .where("id", "=", reqId)
        .select("status")
        .executeTakeFirst();
      expect(request?.status).toBe("open");

      // The later fixture has no matchday yet.
      const lateMatchday = await ctx.db
        .selectFrom("matchday")
        .where("play_cricket_match_id", "=", (eb) =>
          eb
            .selectFrom("availability_fixture")
            .where("id", "=", lateFix)
            .select("play_cricket_match_id"),
        )
        .executeTakeFirst();
      expect(lateMatchday).toBeUndefined();
    });

    it("rejects confirming a fixture with no assignments", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cf-empty-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Empty Confirm XI");
      const reqId = await seedRequest(userId, "2027-06-01", "2027-06-07");
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-06-01",
        "Empty Opp CC",
      );

      await expect(
        confirmFixture(ctx.db)(userId, "admin", reqId, "2027-06-01", fixId),
      ).rejects.toThrow("No players");
    });

    it("throws 409 when re-confirming an already-confirmed fixture", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cf-conflict-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Reconfirm XI");
      const reqId = await seedRequest(userId, "2027-07-01", "2027-07-07");
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-07-01",
        "Reconfirm Opp CC",
      );
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-07-01", {
        fixtureId: fixId,
        playerName: "Guest",
      });

      await confirmFixture(ctx.db)(userId, "admin", reqId, "2027-07-01", fixId);
      await expect(
        confirmFixture(ctx.db)(userId, "admin", reqId, "2027-07-01", fixId),
      ).rejects.toThrow("already exists");
    });

    it("surfaces the confirmed matchday on the date detail", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cf-detail-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Detail Confirm XI");
      const reqId = await seedRequest(userId, "2027-09-01", "2027-09-07");
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-09-01",
        "Detail Opp CC",
      );
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-09-01", {
        fixtureId: fixId,
        playerName: "Guest",
      });

      const before = await getDateDetail(ctx.db)(
        userId,
        "admin",
        reqId,
        "2027-09-01",
      );
      expect(before.fixtures[0].matchdayId).toBeNull();

      const { matchdayId } = await confirmFixture(ctx.db)(
        userId,
        "admin",
        reqId,
        "2027-09-01",
        fixId,
      );

      const after = await getDateDetail(ctx.db)(
        userId,
        "admin",
        reqId,
        "2027-09-01",
      );
      expect(after.fixtures[0].matchdayId).toBe(matchdayId);

      const detail = await getRequest(ctx.db)(userId, "admin", reqId);
      const dateEntry = detail.dates.find((d) => d.date === "2027-09-01");
      expect(dateEntry?.confirmedCount).toBe(1);
    });
  });

  describe("updateRequestStatus", () => {
    it("closes and reopens a request", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `status-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const reqId = await seedRequest(userId, "2027-04-01", "2027-04-07");

      await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "closed",
      });
      const closed = await ctx.db
        .selectFrom("availability_request")
        .where("id", "=", reqId)
        .select("status")
        .executeTakeFirst();
      expect(closed?.status).toBe("closed");

      await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "open",
      });
      const opened = await ctx.db
        .selectFrom("availability_request")
        .where("id", "=", reqId)
        .select("status")
        .executeTakeFirst();
      expect(opened?.status).toBe("open");
    });

    it("auto-creates matchdays on close from every fixture with assignments", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `close-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamA = await seedTeam("Auto XI A");
      const teamB = await seedTeam("Auto XI B");
      const reqId = await seedRequest(userId, "2027-05-01", "2027-05-08");
      const fixA = await seedFixture(
        reqId,
        teamA,
        "2027-05-01",
        "Auto Opp A CC",
      );
      const fixB = await seedFixture(
        reqId,
        teamB,
        "2027-05-08",
        "Auto Opp B CC",
      );
      // Third fixture deliberately has zero assignments - must be skipped.
      await seedFixture(reqId, teamA, "2027-05-05", "Auto Empty CC");

      const memA = await seedMember(
        "Anna",
        `anna-${crypto.randomUUID()}@t.com`,
      );
      const memB = await seedMember("Bob", `bob-${crypto.randomUUID()}@t.com`);
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-05-01", {
        fixtureId: fixA,
        memberId: memA,
        playerName: "Anna",
      });
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-05-08", {
        fixtureId: fixB,
        memberId: memB,
        playerName: "Bob",
      });

      const result = await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "closed",
      });
      expect(result.success).toBe(true);
      expect(result.matchdaysCreated).toBe(2);

      const matchdays = await ctx.db
        .selectFrom("matchday")
        .where("play_cricket_team_id", "in", [teamA, teamB])
        .selectAll()
        .execute();
      expect(matchdays).toHaveLength(2);
      const mdA = matchdays.find((m) => m.play_cricket_team_id === teamA);
      const mdB = matchdays.find((m) => m.play_cricket_team_id === teamB);
      expect(mdA?.opposition).toBe("Auto Opp A CC");
      expect(mdB?.opposition).toBe("Auto Opp B CC");

      const players = await ctx.db
        .selectFrom("matchday_player")
        .where("matchday_id", "in", [mdA?.id ?? "", mdB?.id ?? ""])
        .select(["matchday_id", "player_name", "member_id"])
        .execute();
      expect(players).toHaveLength(2);
      expect(players.find((p) => p.matchday_id === mdA?.id)?.member_id).toBe(
        memA,
      );
    });

    it("re-closing after re-open is idempotent", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `idem-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Idem XI");
      const reqId = await seedRequest(userId, "2027-06-01", "2027-06-07");
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-06-01",
        "Idem Opp CC",
      );
      const memberId = await seedMember(
        "Iggy",
        `iggy-${crypto.randomUUID()}@t.com`,
      );
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-06-01", {
        fixtureId: fixId,
        memberId,
        playerName: "Iggy",
      });

      const first = await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "closed",
      });
      expect(first.matchdaysCreated).toBe(1);

      await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "open",
      });
      const second = await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "closed",
      });
      expect(second.matchdaysCreated).toBe(0);

      const matchdays = await ctx.db
        .selectFrom("matchday")
        .where("play_cricket_team_id", "=", teamId)
        .selectAll()
        .execute();
      expect(matchdays).toHaveLength(1);
    });

    it("closing an already-closed request is a no-op", async () => {
      // The trigger is the open->closed transition, not the target state.
      // A repeated close must not iterate fixtures (saves work; documents
      // that adding assignments after a close needs an explicit reopen).
      const { userId } = await seedTestUser(ctx.db, {
        email: `noop-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Noop XI");
      const reqId = await seedRequest(
        userId,
        "2027-09-01",
        "2027-09-07",
        "closed",
      );
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-09-01",
        "Noop Opp CC",
      );
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-09-01", {
        fixtureId: fixId,
        playerName: "Guest",
      });

      const result = await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "closed",
      });
      expect(result.matchdaysCreated).toBe(0);
      const matchdays = await ctx.db
        .selectFrom("matchday")
        .where("play_cricket_team_id", "=", teamId)
        .selectAll()
        .execute();
      expect(matchdays).toHaveLength(0);
    });

    it("does not create matchdays on re-open", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `reopen-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Reopen XI");
      const reqId = await seedRequest(userId, "2027-07-01", "2027-07-07");
      const fixId = await seedFixture(
        reqId,
        teamId,
        "2027-07-01",
        "Reopen Opp CC",
      );
      await assignPlayer(ctx.db)(userId, "admin", reqId, "2027-07-01", {
        fixtureId: fixId,
        playerName: "Guest",
      });

      const result = await updateRequestStatus(ctx.db)(userId, "admin", reqId, {
        status: "open",
      });
      expect(result.matchdaysCreated).toBe(0);
      const matchdays = await ctx.db
        .selectFrom("matchday")
        .where("play_cricket_team_id", "=", teamId)
        .selectAll()
        .execute();
      expect(matchdays).toHaveLength(0);
    });
  });

  describe("user group scoping", () => {
    it("getActiveRequests hides group-scoped requests from non-members", async () => {
      const inGroupEmail = `g-in-${crypto.randomUUID()}@test.com`;
      const outsiderEmail = `g-out-${crypto.randomUUID()}@test.com`;
      const inGroup = await seedTestUser(ctx.db, {
        email: inGroupEmail,
        withMember: true,
      });
      const outsider = await seedTestUser(ctx.db, {
        email: outsiderEmail,
        withMember: true,
      });
      if (!inGroup.memberId || !outsider.memberId) {
        throw new Error("expected members");
      }

      const admin = await seedTestUser(ctx.db, {
        email: `g-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Group XI");
      const groupId = await seedGroup("Seniors", [inGroup.memberId]);

      const scopedReq = await seedRequest(
        admin.userId,
        "2027-04-01",
        "2027-04-07",
        "open",
        groupId,
      );
      await seedFixture(scopedReq, teamId, "2027-04-01");

      const insideResult = await getActiveRequests(ctx.db)(inGroupEmail);
      const insideIds = insideResult.items.map((r) => r.id);
      expect(insideIds).toContain(scopedReq);

      const outsideResult = await getActiveRequests(ctx.db)(outsiderEmail);
      const outsideIds = outsideResult.items.map((r) => r.id);
      expect(outsideIds).not.toContain(scopedReq);
    });

    it("getDateDetail surfaces non-group responses but scopes the no-response pool", async () => {
      const inGroup = await seedTestUser(ctx.db, {
        email: `dt-in-${crypto.randomUUID()}@test.com`,
        withMember: true,
      });
      const outsider = await seedTestUser(ctx.db, {
        email: `dt-out-${crypto.randomUUID()}@test.com`,
        withMember: true,
      });
      if (!inGroup.memberId || !outsider.memberId) {
        throw new Error("expected members");
      }

      const admin = await seedTestUser(ctx.db, {
        email: `dt-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Detail XI");
      const groupId = await seedGroup("Womens", [inGroup.memberId]);

      const reqId = await seedRequest(
        admin.userId,
        "2027-06-01",
        "2027-06-01",
        "open",
        groupId,
      );
      await seedFixture(reqId, teamId, "2027-06-01");

      await respond(ctx.db)(inGroup.email, reqId, {
        responses: [{ matchDate: "2027-06-01", status: "available" }],
      });
      await respond(ctx.db)(outsider.email, reqId, {
        responses: [{ matchDate: "2027-06-01", status: "available" }],
      });

      const detail = await getDateDetail(ctx.db)(
        admin.userId,
        "admin",
        reqId,
        "2027-06-01",
      );

      // Amendments §2: both responses (group + non-group) surface to
      // officials.
      const availableIds = detail.pools.available.map(
        (r: { member_id: string | null }) => r.member_id,
      );
      expect(availableIds).toContain(inGroup.memberId);
      expect(availableIds).toContain(outsider.memberId);

      // No-response pool stays scoped to the request's groups.
      const noResponseIds = detail.pools.noResponse.map(
        (m: { id: string }) => m.id,
      );
      expect(noResponseIds).not.toContain(outsider.memberId);
    });
  });

  // Regression coverage for the bug where a scoped `official` (assigned to
  // specific teams via team_official) could see and manage fixtures for
  // teams they had no grant on - e.g. a 1st/2nd XI official reaching the
  // Midweek XI fixtures bundled into the same availability request.
  describe("team-scoped access for scoped officials", () => {
    /**
     * Seed an `official` granted `grantTeam`, plus a request whose fixtures
     * span `grantTeam` and a second team the official cannot access. Both
     * fixtures share the same date so the leak can't hide behind date
     * grouping.
     */
    async function seedMixedTeamRequest() {
      const admin = await seedTestUser(ctx.db, {
        email: `tso-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const official = await seedTestUser(ctx.db, {
        email: `tso-official-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const myTeam = await seedTeam("1st XI");
      const otherTeam = await seedTeam("Midweek XI");
      await seedTeamOfficial(official.userId, myTeam);

      const reqId = await seedRequest(admin.userId, "2027-10-01", "2027-10-01");
      const myFix = await seedFixture(reqId, myTeam, "2027-10-01", "My Opp CC");
      const otherFix = await seedFixture(
        reqId,
        otherTeam,
        "2027-10-01",
        "Their Opp CC",
      );

      return { official, myTeam, otherTeam, reqId, myFix, otherFix };
    }

    it("getRequest hides fixtures for teams the official can't access", async () => {
      const { official, reqId } = await seedMixedTeamRequest();

      const result = await getRequest(ctx.db)(
        official.userId,
        "official",
        reqId,
      );

      const teams = result.dates.flatMap((d) =>
        d.fixtures.map((f) => f.team_name),
      );
      expect(teams).toContain("1st XI");
      expect(teams).not.toContain("Midweek XI");
    });

    it("getDateDetail hides fixtures for teams the official can't access", async () => {
      const { official, reqId, myFix } = await seedMixedTeamRequest();

      const detail = await getDateDetail(ctx.db)(
        official.userId,
        "official",
        reqId,
        "2027-10-01",
      );

      expect(detail.fixtures).toHaveLength(1);
      expect(detail.fixtures[0].id).toBe(myFix);
      expect(detail.fixtures[0].team_name).toBe("1st XI");
    });

    it("listRequests only embeds the official's own teams' fixtures", async () => {
      const { official, reqId } = await seedMixedTeamRequest();

      const result = await listRequests(ctx.db)(official.userId, "official", {
        limit: 50,
        offset: 0,
      });

      const req = result.items.find((r) => r.id === reqId);
      expect(req).toBeDefined();
      const teams = req?.fixtures.map((f) => f.team_name) ?? [];
      expect(teams).toEqual(["1st XI"]);
      // fixtureCount reflects only the fixtures the official can see.
      expect(req?.fixtureCount).toBe(1);
    });

    it("getRequest 404s when the official can access none of its teams", async () => {
      const admin = await seedTestUser(ctx.db, {
        email: `tso-none-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const official = await seedTestUser(ctx.db, {
        email: `tso-none-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      // Official is granted a team, but the request has no fixture for it.
      await seedTeamOfficial(official.userId, await seedTeam("3rd XI"));
      const otherTeam = await seedTeam("Sunday XI");
      const reqId = await seedRequest(admin.userId, "2027-10-08", "2027-10-08");
      await seedFixture(reqId, otherTeam, "2027-10-08");

      await expect(
        getRequest(ctx.db)(official.userId, "official", reqId),
      ).rejects.toThrow("not found");
    });

    it("assignPlayer 403s on a fixture the official can't access", async () => {
      const { official, reqId, otherFix } = await seedMixedTeamRequest();

      await expect(
        assignPlayer(ctx.db)(official.userId, "official", reqId, "2027-10-01", {
          fixtureId: otherFix,
          playerName: "Sneaky Pick",
        }),
      ).rejects.toThrow("access");
    });

    it("assignPlayer allows a fixture the official does own", async () => {
      const { official, reqId, myFix } = await seedMixedTeamRequest();

      const { id } = await assignPlayer(ctx.db)(
        official.userId,
        "official",
        reqId,
        "2027-10-01",
        { fixtureId: myFix, playerName: "Legit Pick" },
      );
      expect(id).toBeDefined();
    });

    it("confirmFixture 403s on a fixture the official can't access", async () => {
      const { official, reqId, otherFix } = await seedMixedTeamRequest();

      await expect(
        confirmFixture(ctx.db)(
          official.userId,
          "official",
          reqId,
          "2027-10-01",
          otherFix,
        ),
      ).rejects.toThrow("access");
    });

    it("confirmDate only materialises the official's own teams' fixtures", async () => {
      const { official, reqId, myFix, otherFix } = await seedMixedTeamRequest();
      // Assign a player to each fixture so both are materialisable.
      await assignPlayer(ctx.db)(
        official.userId,
        "official",
        reqId,
        "2027-10-01",
        {
          fixtureId: myFix,
          playerName: "Mine",
        },
      );
      // Seed an assignment on the other team's fixture directly (the official
      // can't via the API, which is the point).
      await ctx.db
        .insertInto("availability_assignment")
        .values({
          id: crypto.randomUUID(),
          availability_fixture_id: otherFix,
          player_name: "Theirs",
          position: 1,
        })
        .execute();

      const result = await confirmDate(ctx.db)(
        official.userId,
        "official",
        reqId,
        "2027-10-01",
      );

      // Only the official's own fixture is confirmed into a matchday.
      expect(result.matchdays).toHaveLength(1);
      expect(result.matchdays[0].fixtureId).toBe(myFix);
    });

    it("updateRequestStatus 403s for a scoped official", async () => {
      const { official, reqId } = await seedMixedTeamRequest();

      await expect(
        updateRequestStatus(ctx.db)(official.userId, "official", reqId, {
          status: "closed",
        }),
      ).rejects.toThrow("club-wide");
    });

    it("getRequest assignmentCount excludes hidden teams sharing a date", async () => {
      const { official, reqId, myFix, otherFix } = await seedMixedTeamRequest();
      // One pick on the official's fixture, one on the hidden fixture - both
      // on the same date (2027-10-01).
      await ctx.db
        .insertInto("availability_assignment")
        .values([
          {
            id: crypto.randomUUID(),
            availability_fixture_id: myFix,
            player_name: "Mine",
            position: 1,
          },
          {
            id: crypto.randomUUID(),
            availability_fixture_id: otherFix,
            player_name: "Theirs",
            position: 1,
          },
        ])
        .execute();

      const result = await getRequest(ctx.db)(
        official.userId,
        "official",
        reqId,
      );
      const dateEntry = result.dates.find((d) => d.date === "2027-10-01");
      // Only the official's own pick is counted, not the hidden team's.
      expect(dateEntry?.assignmentCount).toBe(1);
    });

    it("listRequests respondentCount ignores responses on inaccessible dates", async () => {
      const admin = await seedTestUser(ctx.db, {
        email: `rc-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const official = await seedTestUser(ctx.db, {
        email: `rc-official-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const myTeam = await seedTeam("1st XI");
      const otherTeam = await seedTeam("Midweek XI");
      await seedTeamOfficial(official.userId, myTeam);

      // Two dates: the official can access 10-15 only; the response lands on
      // the inaccessible team's date (10-22).
      const reqId = await seedRequest(admin.userId, "2027-10-15", "2027-10-22");
      await seedFixture(reqId, myTeam, "2027-10-15");
      await seedFixture(reqId, otherTeam, "2027-10-22");
      const memberId = await seedMember(
        "Responder",
        `resp-${crypto.randomUUID()}@test.com`,
      );
      await ctx.db
        .insertInto("availability_response")
        .values({
          id: crypto.randomUUID(),
          availability_request_id: reqId,
          member_id: memberId,
          match_date: "2027-10-22",
          status: "available",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      const officialView = await listRequests(ctx.db)(
        official.userId,
        "official",
        { limit: 50, offset: 0 },
      );
      const officialReq = officialView.items.find((r) => r.id === reqId);
      expect(officialReq?.respondentCount).toBe(0);

      const adminView = await listRequests(ctx.db)(admin.userId, "admin", {
        limit: 50,
        offset: 0,
      });
      const adminReq = adminView.items.find((r) => r.id === reqId);
      expect(adminReq?.respondentCount).toBe(1);
    });

    it("getDateDetail 404s as not-found (not 'no fixtures') on an inaccessible date", async () => {
      const admin = await seedTestUser(ctx.db, {
        email: `dd-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const official = await seedTestUser(ctx.db, {
        email: `dd-official-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const myTeam = await seedTeam("1st XI");
      const otherTeam = await seedTeam("Midweek XI");
      await seedTeamOfficial(official.userId, myTeam);

      const reqId = await seedRequest(admin.userId, "2027-11-01", "2027-11-08");
      await seedFixture(reqId, myTeam, "2027-11-01");
      await seedFixture(reqId, otherTeam, "2027-11-08");

      // The official can see the request (has a fixture on 11-01) but not the
      // 11-08 date - the 404 must read like a missing request, matching
      // getRequest, so it can't be used to probe request existence.
      await expect(
        getDateDetail(ctx.db)(official.userId, "official", reqId, "2027-11-08"),
      ).rejects.toThrow("Availability request not found");
    });
  });
});
