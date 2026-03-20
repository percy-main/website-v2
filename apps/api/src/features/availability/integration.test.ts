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

describe("availability requests", () => {
  it("creates a request and auto-creates availability dates", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-06-15",
    });
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-06-16",
    });

    const result = await createRequest(ctx.db)(userId, "admin", {
      startDate: "2026-06-14",
      endDate: "2026-06-17",
    });

    expect(result.id).toBeDefined();
    expect(result.datesCreated).toBe(2);
  });

  it("rejects overlapping requests", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-07-01",
    });

    await createRequest(ctx.db)(userId, "admin", {
      startDate: "2026-06-30",
      endDate: "2026-07-05",
    });

    await expect(
      createRequest(ctx.db)(userId, "admin", {
        startDate: "2026-07-03",
        endDate: "2026-07-10",
      }),
    ).rejects.toThrow("overlaps");
  });

  it("rejects start date after end date", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });

    await expect(
      createRequest(ctx.db)(userId, "admin", {
        startDate: "2026-07-10",
        endDate: "2026-07-05",
      }),
    ).rejects.toThrow("before");
  });

  it("lists requests with summary counts", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-08-01",
    });

    await createRequest(ctx.db)(userId, "admin", {
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    });

    const result = await listRequests(ctx.db)(userId, "admin");
    expect(result.length).toBeGreaterThanOrEqual(1);

    const req = result.find((r) => r.start_date === "2026-08-01");
    expect(req).toBeDefined();
    expect(req?.totalDates).toBe(1);
  });

  it("gets request detail with dates and matchdays", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-09-01",
      opposition: "Team Alpha",
    });

    const { id } = await createRequest(ctx.db)(userId, "admin", {
      startDate: "2026-09-01",
      endDate: "2026-09-07",
    });

    const detail = await getRequest(ctx.db)(userId, "admin", id);
    expect(detail.dates).toHaveLength(1);
    expect(detail.dates[0].matchDate).toBe("2026-09-01");
    expect(detail.dates[0].matchdays).toHaveLength(1);
  });

  it("deletes a request and cascades", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-10-01",
    });

    const { id } = await createRequest(ctx.db)(userId, "admin", {
      startDate: "2026-10-01",
      endDate: "2026-10-07",
    });

    await deleteRequest(ctx.db)(userId, "admin", id);

    await expect(getRequest(ctx.db)(userId, "admin", id)).rejects.toThrow(
      "not found",
    );
  });

  it("previews games in a window", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-11-01",
    });

    const result = await previewGamesInWindow(ctx.db)(
      userId,
      "admin",
      "2026-11-01",
      "2026-11-07",
    );

    expect(result.matchdays.length).toBeGreaterThanOrEqual(1);
    expect(result.overlapping).toBe(false);
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

    const { id: requestId } = await createRequest(ctx.db)(userId, "admin", {
      startDate: "2026-12-01",
      endDate: "2026-12-07",
    });

    const grid = await getAvailabilityGrid(ctx.db)(
      userId,
      "admin",
      requestId,
      "2026-12-01",
    );

    expect(grid.matchDate).toBe("2026-12-01");
    expect(Array.isArray(grid.grid)).toBe(true);
    expect(grid.matchdays.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns a player to a matchday from the grid", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Charlie", "charlie-req@test.com");
    const matchdayId = await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2027-01-05",
    });

    const { id: requestId } = await createRequest(ctx.db)(userId, "admin", {
      startDate: "2027-01-05",
      endDate: "2027-01-07",
    });

    // Get the availability_date_id
    const grid = await getAvailabilityGrid(ctx.db)(
      userId,
      "admin",
      requestId,
      "2027-01-05",
    );
    const dateId = grid.availabilityDateIds[0];

    const result = await assignPlayer(ctx.db)(userId, "admin", dateId, {
      matchdayId,
      memberId,
    });

    expect(result.id).toBeDefined();
  });

  it("unassigns a player", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Dave", "dave-req@test.com");
    const matchdayId = await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2027-01-10",
    });

    const { id: requestId } = await createRequest(ctx.db)(userId, "admin", {
      startDate: "2027-01-10",
      endDate: "2027-01-12",
    });

    const grid = await getAvailabilityGrid(ctx.db)(
      userId,
      "admin",
      requestId,
      "2027-01-10",
    );
    const dateId = grid.availabilityDateIds[0];

    await assignPlayer(ctx.db)(userId, "admin", dateId, {
      matchdayId,
      memberId,
    });

    const result = await unassignPlayer(ctx.db)(userId, "admin", dateId, {
      matchdayId,
      memberId,
    });

    expect(result.success).toBe(true);
  });

  it("officials can set availability on behalf of a member", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Alice", "alice-req@test.com");
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2027-02-01",
    });

    const { id: requestId } = await createRequest(ctx.db)(userId, "admin", {
      startDate: "2027-02-01",
      endDate: "2027-02-07",
    });

    const grid = await getAvailabilityGrid(ctx.db)(
      userId,
      "admin",
      requestId,
      "2027-02-01",
    );
    const dateId = grid.availabilityDateIds[0];

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
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2027-03-01",
    });

    const { id: requestId } = await createRequest(ctx.db)(userId, "official", {
      startDate: "2027-03-01",
      endDate: "2027-03-07",
    });

    const grid = await getAvailabilityGrid(ctx.db)(
      userId,
      "official",
      requestId,
      "2027-03-01",
    );
    const dateId = grid.availabilityDateIds[0];

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
    await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2027-03-15",
    });

    const { id: requestId } = await createRequest(ctx.db)(userId, "official", {
      startDate: "2027-03-15",
      endDate: "2027-03-20",
    });

    const grid = await getAvailabilityGrid(ctx.db)(
      userId,
      "official",
      requestId,
      "2027-03-15",
    );
    const dateId = grid.availabilityDateIds[0];

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
