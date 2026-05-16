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
  getActiveRequests,
  getDateDetail,
  getRequest,
  listRequests,
  removeAssignment,
  respond,
  setAvailability,
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
      const result = await listRequests(ctx.db)({ limit: 20, offset: 0 });
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

      const result = await listRequests(ctx.db)({ limit: 20, offset: 0 });
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

      const result = await getRequest(ctx.db)(reqId);
      expect(result.request.id).toBe(reqId);
      expect(result.dates).toHaveLength(2);
      expect(result.dates[0].date).toBe("2026-07-01");
      expect(result.dates[1].date).toBe("2026-07-05");
    });

    it("throws 404 for non-existent request", async () => {
      await expect(getRequest(ctx.db)("nonexistent")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("getDateDetail + assignPlayer", () => {
    it("returns fixture details and player pools", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `detail-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("3rd XI");
      const reqId = await seedRequest(userId, "2026-08-01", "2026-08-07");
      const fixId = await seedFixture(reqId, teamId, "2026-08-01");

      // Seed some members
      const memberId1 = await seedMember(
        "Alice",
        `alice-${crypto.randomUUID()}@test.com`,
      );
      const memberId2 = await seedMember(
        "Bob",
        `bob-${crypto.randomUUID()}@test.com`,
      );

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

      const result = await getDateDetail(ctx.db)(reqId, "2026-08-01");
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
      const detail = await getDateDetail(ctx.db)(reqId, "2026-09-01");
      expect(detail.fixtures[0].assignments).toHaveLength(1);
      expect(detail.fixtures[0].assignments[0].player_name).toBe("Charlie");

      // Duplicate assignment should fail
      await expect(
        assignPlayer(ctx.db)(reqId, "2026-09-01", {
          fixtureId: fixId,
          memberId,
          playerName: "Charlie",
        }),
      ).rejects.toThrow("already assigned");

      // Remove assignment
      const removeResult = await removeAssignment(ctx.db)(assignId);
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

      const { id: assignId } = await assignPlayer(ctx.db)(reqId, "2026-10-01", {
        fixtureId: fixId,
        playerName: "Guest Player",
      });
      expect(assignId).toBeDefined();

      const detail = await getDateDetail(ctx.db)(reqId, "2026-10-01");
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
        setAvailability(ctx.db)(userId, reqId, "2026-11-20", memberId, {
          status: "available",
        }),
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
      await seedTestUser(ctx.db, { email, withMember: true });

      const adminUser = await seedTestUser(ctx.db, {
        email: `admin-active-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam("Active XI");
      const reqId = await seedRequest(
        adminUser.userId,
        "2027-02-01",
        "2027-02-07",
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
      await assignPlayer(ctx.db)(reqId, "2027-03-01", {
        fixtureId: fixId,
        memberId,
        playerName: "Hank",
      });
      await assignPlayer(ctx.db)(reqId, "2027-03-01", {
        fixtureId: fixId,
        playerName: "Guest Player",
      });

      // Confirm
      const result = await confirmDate(ctx.db)(userId, reqId, "2027-03-01");
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
  });

  describe("updateRequestStatus", () => {
    it("closes and reopens a request", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `status-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const reqId = await seedRequest(userId, "2027-04-01", "2027-04-07");

      await updateRequestStatus(ctx.db)(reqId, { status: "closed" });
      const closed = await ctx.db
        .selectFrom("availability_request")
        .where("id", "=", reqId)
        .select("status")
        .executeTakeFirst();
      expect(closed?.status).toBe("closed");

      await updateRequestStatus(ctx.db)(reqId, { status: "open" });
      const opened = await ctx.db
        .selectFrom("availability_request")
        .where("id", "=", reqId)
        .select("status")
        .executeTakeFirst();
      expect(opened?.status).toBe("open");
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

      const detail = await getDateDetail(ctx.db)(reqId, "2027-06-01");

      // Amendments §2: both responses (group + non-group) surface to
      // officials.
      const availableIds = detail.pools.available.map(
        (r: { member_id: string }) => r.member_id,
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
});
