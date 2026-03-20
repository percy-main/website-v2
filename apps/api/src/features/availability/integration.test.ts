import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  assignPlayer,
  createAvailabilityDate,
  declareAvailability,
  deleteAvailabilityDate,
  getAvailabilityGrid,
  getMyAvailability,
  listAvailabilityDates,
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

/** Seed a play_cricket_team row. */
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

/** Seed a team_official row. */
async function seedTeamOfficial(userId: string, teamId: string) {
  await ctx.db
    .insertInto("team_official")
    .values({ user_id: userId, play_cricket_team_id: teamId })
    .execute();
}

/** Seed a member row. */
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

/** Seed a matchday row. */
async function seedMatchday(overrides: {
  teamId: string;
  createdBy: string;
  matchDate?: string;
  status?: string;
}) {
  const id = `md-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("matchday")
    .values({
      id,
      play_cricket_team_id: overrides.teamId,
      match_date: overrides.matchDate ?? "2026-06-15",
      opposition: "Opposition CC",
      created_by: overrides.createdBy,
      status: overrides.status ?? "pending",
    })
    .execute();
  return id;
}

describe("availability — official services", () => {
  it("creates an availability date", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    const result = await createAvailabilityDate(ctx.db)(userId, "admin", {
      teamId,
      matchDate: "2026-06-15",
    });

    expect(result.id).toBeDefined();
  });

  it("rejects duplicate availability date for same team + date", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    await createAvailabilityDate(ctx.db)(userId, "admin", {
      teamId,
      matchDate: "2026-06-20",
    });

    await expect(
      createAvailabilityDate(ctx.db)(userId, "admin", {
        teamId,
        matchDate: "2026-06-20",
      }),
    ).rejects.toThrow("already exists");
  });

  it("rejects access for non-official user", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "official" });
    const teamId = await seedTeam();
    // No team_official entry, so user has no access

    await expect(
      createAvailabilityDate(ctx.db)(userId, "official", {
        teamId,
        matchDate: "2026-06-21",
      }),
    ).rejects.toThrow("do not have access");
  });

  it("lists availability dates with declarations", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    await createAvailabilityDate(ctx.db)(userId, "admin", {
      teamId,
      matchDate: "2026-07-01",
    });
    await createAvailabilityDate(ctx.db)(userId, "admin", {
      teamId,
      matchDate: "2026-07-08",
    });

    const result = await listAvailabilityDates(ctx.db)(userId, "admin", {
      teamId,
    });

    expect(result).toHaveLength(2);
    expect(result[0].match_date).toBe("2026-07-01");
    expect(result[1].match_date).toBe("2026-07-08");
    expect(result[0].declarations).toEqual([]);
  });

  it("deletes an availability date", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    const { id } = await createAvailabilityDate(ctx.db)(userId, "admin", {
      teamId,
      matchDate: "2026-07-15",
    });

    const result = await deleteAvailabilityDate(ctx.db)(userId, "admin", id);
    expect(result.success).toBe(true);

    const dates = await listAvailabilityDates(ctx.db)(userId, "admin", {
      teamId,
    });
    expect(dates.find((d) => d.id === id)).toBeUndefined();
  });

  it("officials can set availability on behalf of a member", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Alice", "alice@test.com");

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "admin",
      { teamId, matchDate: "2026-08-01" },
    );

    const result = await setAvailabilityForMember(ctx.db)(
      userId,
      "admin",
      dateId,
      { memberId, status: "available" },
    );

    expect(result.id).toBeDefined();

    // Verify it shows in the grid
    const grid = await getAvailabilityGrid(ctx.db)(userId, "admin", dateId);
    const aliceRow = grid.grid.find((g) => g.memberId === memberId);
    expect(aliceRow?.availabilityStatus).toBe("available");
  });

  it("officials can update existing availability", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Bob", "bob@test.com");

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "admin",
      { teamId, matchDate: "2026-08-02" },
    );

    await setAvailabilityForMember(ctx.db)(userId, "admin", dateId, {
      memberId,
      status: "available",
    });

    // Update to unavailable
    await setAvailabilityForMember(ctx.db)(userId, "admin", dateId, {
      memberId,
      status: "unavailable",
      notes: "Injured",
    });

    const grid = await getAvailabilityGrid(ctx.db)(userId, "admin", dateId);
    const bobRow = grid.grid.find((g) => g.memberId === memberId);
    expect(bobRow?.availabilityStatus).toBe("unavailable");
    expect(bobRow?.availabilityNotes).toBe("Injured");
  });
});

describe("availability — grid and assignments", () => {
  it("returns the grid with members and matchdays", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "admin",
      { teamId, matchDate: "2026-09-01" },
    );

    const grid = await getAvailabilityGrid(ctx.db)(userId, "admin", dateId);

    expect(grid.date.id).toBe(dateId);
    expect(Array.isArray(grid.grid)).toBe(true);
    expect(Array.isArray(grid.matchdays)).toBe(true);
  });

  it("assigns a player to a matchday from the grid", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Charlie", "charlie@test.com");

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "admin",
      { teamId, matchDate: "2026-09-05" },
    );

    const matchdayId = await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-09-05",
    });

    const result = await assignPlayer(ctx.db)(userId, "admin", dateId, {
      matchdayId,
      memberId,
    });

    expect(result.id).toBeDefined();

    // Verify it shows in the grid
    const grid = await getAvailabilityGrid(ctx.db)(userId, "admin", dateId);
    const charlieRow = grid.grid.find((g) => g.memberId === memberId);
    expect(charlieRow?.assignments).toHaveLength(1);
    expect(charlieRow?.assignments[0].matchdayId).toBe(matchdayId);
  });

  it("rejects duplicate assignment", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Dup", "dup@test.com");

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "admin",
      { teamId, matchDate: "2026-09-06" },
    );

    const matchdayId = await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-09-06",
    });

    await assignPlayer(ctx.db)(userId, "admin", dateId, {
      matchdayId,
      memberId,
    });

    await expect(
      assignPlayer(ctx.db)(userId, "admin", dateId, {
        matchdayId,
        memberId,
      }),
    ).rejects.toThrow("already assigned");
  });

  it("unassigns a player from a matchday", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Dave", "dave@test.com");

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "admin",
      { teamId, matchDate: "2026-09-07" },
    );

    const matchdayId = await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-09-07",
    });

    await assignPlayer(ctx.db)(userId, "admin", dateId, {
      matchdayId,
      memberId,
    });

    const result = await unassignPlayer(ctx.db)(userId, "admin", dateId, {
      matchdayId,
      memberId,
    });

    expect(result.success).toBe(true);

    // Verify removed from grid
    const grid = await getAvailabilityGrid(ctx.db)(userId, "admin", dateId);
    const daveRow = grid.grid.find((g) => g.memberId === memberId);
    expect(daveRow?.assignments).toHaveLength(0);
  });

  it("rejects assignment when matchday date does not match", async () => {
    const { userId } = await seedTestUser(ctx.db, { role: "admin" });
    const teamId = await seedTeam();
    const memberId = await seedMember("Eve", "eve@test.com");

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "admin",
      { teamId, matchDate: "2026-09-10" },
    );

    // Matchday on a different date
    const matchdayId = await seedMatchday({
      teamId,
      createdBy: userId,
      matchDate: "2026-09-11",
    });

    await expect(
      assignPlayer(ctx.db)(userId, "admin", dateId, {
        matchdayId,
        memberId,
      }),
    ).rejects.toThrow("not on the same date");
  });
});

describe("availability — member services", () => {
  it("member declares availability", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      role: "official",
      withMember: true,
    });
    const teamId = await seedTeam();
    await seedTeamOfficial(userId, teamId);

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "official",
      { teamId, matchDate: "2026-10-01" },
    );

    const result = await declareAvailability(ctx.db)(userId, dateId, {
      status: "available",
      notes: "Free all day",
    });

    expect(result.id).toBeDefined();
  });

  it("member can update their declaration", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      role: "official",
      withMember: true,
    });
    const teamId = await seedTeam();
    await seedTeamOfficial(userId, teamId);

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "official",
      { teamId, matchDate: "2026-10-02" },
    );

    await declareAvailability(ctx.db)(userId, dateId, {
      status: "available",
    });

    // Update to maybe
    const result = await declareAvailability(ctx.db)(userId, dateId, {
      status: "maybe",
      notes: "Need to check",
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

    const { id: dateId } = await createAvailabilityDate(ctx.db)(
      userId,
      "official",
      { teamId, matchDate: "2026-10-03" },
    );

    await declareAvailability(ctx.db)(userId, dateId, {
      status: "available",
    });

    const result = await getMyAvailability(ctx.db)(userId);

    expect(result.memberId).toBeDefined();
    const date = result.dates.find((d) => d.id === dateId);
    expect(date).toBeDefined();
    expect(date?.myStatus).toBe("available");
  });

  it("returns empty dates for user without member record", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      withMember: false,
    });

    const result = await getMyAvailability(ctx.db)(userId);
    expect(result.memberId).toBeNull();
    expect(result.dates).toEqual([]);
  });
});
