import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  assignPlayer,
  createRequest,
  declareAvailability,
  deleteRequest,
  getAvailabilityGrid,
  getMyAvailability,
  getRequest,
  listRequests,
  previewGamesInWindow,
  setAvailabilityForMember,
  unassignPlayer,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

async function seedTeam(id?: string) {
  const teamId = id ?? `pct-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("play_cricket_team")
    .values({
      id: teamId,
      name: `Team ${teamId.slice(0, 6)}`,
      site_id: "site-1",
    })
    .execute();
  return teamId;
}

async function seedTeamOfficial(userId: string, teamId: string) {
  await ctx.db
    .insertInto("team_official")
    .values({ user_id: userId, play_cricket_team_id: teamId })
    .execute();
}

async function seedMember(name: string, email: string, category?: string) {
  const id = `mem-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("member")
    .values({
      id,
      name,
      email,
      member_category: category ?? "senior",
    })
    .execute();
  return id;
}

async function seedMatchday(overrides: {
  teamId: string;
  createdBy: string;
  matchDate?: string;
  opposition?: string;
}) {
  const id = `md-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("matchday")
    .values({
      id,
      play_cricket_team_id: overrides.teamId,
      match_date: overrides.matchDate ?? "2026-06-15",
      opposition: overrides.opposition ?? "Opposition CC",
      created_by: overrides.createdBy,
      status: "pending",
    })
    .execute();
  return id;
}

/** Seed an availability date manually (since tests have no Play Cricket API). */
async function seedAvailabilityDate(
  requestId: string,
  teamId: string,
  matchDate: string,
  createdBy: string,
) {
  const id = `ad-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("availability_date")
    .values({
      id,
      availability_request_id: requestId,
      play_cricket_team_id: teamId,
      match_date: matchDate,
      created_by: createdBy,
    })
    .execute();
  return id;
}

// No Play Cricket API in tests — pass null
const noApi = null;
const noSiteId = "";

describe("availability requests", () => {
  it("creates a request", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    await seedTeam();

    const result = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2026-06-14", endDate: "2026-06-17" },
    );

    expect(result.id).toBeDefined();
    // No Play Cricket API = 0 auto-created dates
    expect(result.datesCreated).toBe(0);
  });

  it("rejects overlapping requests", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    await seedTeam();

    await createRequest(ctx.db, noApi, noSiteId)(userId, "admin", {
      startDate: "2026-06-30",
      endDate: "2026-07-05",
    });

    await expect(
      createRequest(ctx.db, noApi, noSiteId)(userId, "admin", {
        startDate: "2026-07-03",
        endDate: "2026-07-10",
      }),
    ).rejects.toThrow("overlaps");
  });

  it("rejects start date after end date", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });

    await expect(
      createRequest(ctx.db, noApi, noSiteId)(userId, "admin", {
        startDate: "2026-07-10",
        endDate: "2026-07-05",
      }),
    ).rejects.toThrow("before");
  });

  it("lists requests with summary counts", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2026-08-01", endDate: "2026-08-07" },
    );
    await seedAvailabilityDate(requestId, teamId, "2026-08-01", userId);

    const result = await listRequests(ctx.db)(userId, "admin");
    const req = result.find((r) => r.id === requestId);
    expect(req).toBeDefined();
    expect(req?.totalDates).toBe(1);
  });

  it("gets request detail with dates", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2026-09-01", endDate: "2026-09-07" },
    );
    await seedAvailabilityDate(requestId, teamId, "2026-09-01", userId);

    const detail = await getRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      requestId,
    );
    expect(detail.dates).toHaveLength(1);
    expect(detail.dates[0].matchDate).toBe("2026-09-01");
  });

  it("deletes a request and cascades", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2026-10-01", endDate: "2026-10-07" },
    );
    await seedAvailabilityDate(requestId, teamId, "2026-10-01", userId);

    await deleteRequest(ctx.db)(userId, "admin", requestId);

    await expect(
      getRequest(ctx.db, noApi, noSiteId)(userId, "admin", requestId),
    ).rejects.toThrow("not found");
  });

  it("preview returns overlap status", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    await seedTeam();

    // No Play Cricket API so fixtures will be empty, but overlap check works
    const result = await previewGamesInWindow(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      "2026-11-01",
      "2026-11-07",
    );

    expect(result.overlapping).toBe(false);
    expect(result.fixtures).toEqual([]);
  });
});

describe("availability grid and assignments", () => {
  it("returns the grid for a date within a request", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-12-01",
    });

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2026-12-01", endDate: "2026-12-07" },
    );
    await seedAvailabilityDate(requestId, teamId, "2026-12-01", userId);

    const grid = await getAvailabilityGrid(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      requestId,
      "2026-12-01",
    );

    expect(grid.matchDate).toBe("2026-12-01");
    expect(Array.isArray(grid.grid)).toBe(true);
    expect(grid.matchdays.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns a player to a fixture from the grid", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Charlie", "charlie-req@test.com");

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2027-01-05", endDate: "2027-01-07" },
    );
    const dateId = await seedAvailabilityDate(
      requestId,
      teamId,
      "2027-01-05",
      userId,
    );

    const result = await assignPlayer(ctx.db)(userId, "admin", dateId, {
      memberId,
      teamId,
      opposition: "Opposition CC",
    });

    expect(result.id).toBeDefined();
    expect(result.matchdayId).toBeDefined();
  });

  it("creates matchday on-the-fly when assigning without one", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Eve", "eve-req@test.com");

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2027-01-08", endDate: "2027-01-09" },
    );
    const dateId = await seedAvailabilityDate(
      requestId,
      teamId,
      "2027-01-08",
      userId,
    );

    // No matchday seeded — should be auto-created
    const result = await assignPlayer(ctx.db)(userId, "admin", dateId, {
      memberId,
      teamId,
      opposition: "Auto CC",
    });

    expect(result.id).toBeDefined();
    expect(result.matchdayId).toBeDefined();

    // Verify matchday was created
    const md = await ctx.db
      .selectFrom("matchday")
      .where("id", "=", result.matchdayId)
      .selectAll()
      .executeTakeFirst();
    expect(md?.opposition).toBe("Auto CC");
    expect(md?.match_date).toBe("2027-01-08");
  });

  it("unassigns a player", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Dave", "dave-req@test.com");

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2027-01-10", endDate: "2027-01-12" },
    );
    const dateId = await seedAvailabilityDate(
      requestId,
      teamId,
      "2027-01-10",
      userId,
    );

    await assignPlayer(ctx.db)(userId, "admin", dateId, {
      memberId,
      teamId,
      opposition: "Unassign CC",
    });

    const result = await unassignPlayer(ctx.db)(userId, "admin", dateId, {
      memberId,
      teamId,
    });

    expect(result.success).toBe(true);
  });

  it("officials can set availability on behalf of a member", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Alice", "alice-req@test.com");

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "admin",
      { startDate: "2027-02-01", endDate: "2027-02-07" },
    );
    const dateId = await seedAvailabilityDate(
      requestId,
      teamId,
      "2027-02-01",
      userId,
    );

    const result = await setAvailabilityForMember(ctx.db)(
      userId,
      "admin",
      dateId,
      { memberId, status: "available" },
    );

    expect(result.id).toBeDefined();
  });
});

describe("member services", () => {
  it("member declares availability", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      role: "official",
      withMember: true,
    });
    const teamId = await seedTeam();
    await seedTeamOfficial(userId, teamId);

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "official",
      { startDate: "2027-03-01", endDate: "2027-03-07" },
    );
    const dateId = await seedAvailabilityDate(
      requestId,
      teamId,
      "2027-03-01",
      userId,
    );

    const result = await declareAvailability(ctx.db)(userId, dateId, {
      status: "available",
      notes: "Free all day",
    });

    expect(result.id).toBeDefined();
  });

  it("getMyAvailability returns dates with member status", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      role: "official",
      withMember: true,
    });
    const teamId = await seedTeam();
    await seedTeamOfficial(userId, teamId);

    const { id: requestId } = await createRequest(ctx.db, noApi, noSiteId)(
      userId,
      "official",
      { startDate: "2027-03-15", endDate: "2027-03-20" },
    );
    const dateId = await seedAvailabilityDate(
      requestId,
      teamId,
      "2027-03-15",
      userId,
    );

    await declareAvailability(ctx.db)(userId, dateId, {
      status: "maybe",
    });

    const result = await getMyAvailability(ctx.db)(userId);
    expect(result.memberId).toBeDefined();
    const date = result.dates.find((d) => d.id === dateId);
    expect(date?.myStatus).toBe("maybe");
  });

  it("returns empty for user without member record", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    const result = await getMyAvailability(ctx.db)(userId);
    expect(result.memberId).toBeNull();
    expect(result.dates).toEqual([]);
  });
});
