import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import {
  addPlayer,
  confirmTeam,
  createMatchday,
  deleteExpense,
  getMatch,
  listMatches,
  listTeams,
  recordExpense,
  removePlayer,
  searchMembers,
} from "./service.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

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

/** Seed a matchday row. */
async function seedMatchday(overrides: {
  teamId: string;
  createdBy: string;
  status?: string;
  matchDate?: string;
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

/** Seed a team_official row linking a user to a team. */
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
      title: "",
      address: "",
      postcode: "",
      dob: "",
      telephone: "",
      emergency_contact_name: "",
      emergency_contact_telephone: "",
      member_category: category ?? "senior",
    })
    .execute();
  return id;
}

/** Seed a match fee rate. */
async function seedFeeRate(overrides: {
  teamId?: string;
  competitionType?: string;
  memberCategory: string;
  amountPence: number;
}) {
  const id = `mfr-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("match_fee_rate")
    .values({
      id,
      play_cricket_team_id: overrides.teamId ?? null,
      competition_type: overrides.competitionType ?? null,
      member_category: overrides.memberCategory,
      amount_pence: overrides.amountPence,
    })
    .execute();
  return id;
}

describe("matchday service (integration)", () => {
  describe("listMatches", () => {
    it("returns empty when no matchdays exist for the user", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `nomatches-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });

      const result = await listMatches(ctx.db)(userId, "admin", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      expect(result.items).toEqual([]);
    });

    it("returns matches after seeding for admin user", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `adminmatches-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchId = await seedMatchday({ teamId, createdBy: userId });

      const result = await listMatches(ctx.db)(userId, "admin", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      const ids = result.items.map((m) => m.id);
      expect(ids).toContain(matchId);
    });

    it("non-admin only sees matches for teams they officiate", async () => {
      const { userId: officialId } = await seedTestUser(ctx.db, {
        email: `official-${crypto.randomUUID()}@test.com`,
      });
      const { userId: otherUserId } = await seedTestUser(ctx.db, {
        email: `other-${crypto.randomUUID()}@test.com`,
      });

      const teamA = await seedTeam();
      const teamB = await seedTeam();

      await seedTeamOfficial(officialId, teamA);

      const matchA = await seedMatchday({
        teamId: teamA,
        createdBy: officialId,
      });
      await seedMatchday({ teamId: teamB, createdBy: otherUserId });

      const result = await listMatches(ctx.db)(officialId, "official", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      const ids = result.items.map((m) => m.id);
      expect(ids).toContain(matchA);
      // Should not contain teamB's match
      expect(result.items.every((m) => m.play_cricket_team_id === teamA)).toBe(
        true,
      );
    });

    it("filters by status", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `statusfilter-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const pendingId = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "pending",
      });
      await seedMatchday({
        teamId,
        createdBy: userId,
        status: "confirmed",
      });

      const result = await listMatches(ctx.db)(userId, "admin", {
        limit: 20,
        offset: 0,
        statusFilter: "pending",
      });

      const ids = result.items.map((m) => m.id);
      expect(ids).toContain(pendingId);
      for (const item of result.items) {
        expect(item.status).toBe("pending");
      }
    });
  });

  describe("listTeams", () => {
    it("returns teams for an official", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `listteams-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const teamId = await seedTeam();
      await seedTeamOfficial(userId, teamId);

      const result = await listTeams(ctx.db)(userId, "official");
      const ids = result.map((t) => t.id);
      expect(ids).toContain(teamId);
    });
  });

  describe("createMatchday", () => {
    it("creates a matchday for an accessible team", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `create-md-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();

      const result = await createMatchday(ctx.db)(userId, "admin", {
        teamId,
        matchDate: "2026-07-01",
        opposition: "Rival CC",
      });

      expect(result.id).toBeDefined();

      // Verify in DB
      const row = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", result.id)
        .selectAll()
        .executeTakeFirst();
      expect(row?.opposition).toBe("Rival CC");
      expect(row?.status).toBe("pending");
    });

    it("rejects duplicate matchday for same team and date", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `dup-md-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();

      await createMatchday(ctx.db)(userId, "admin", {
        teamId,
        matchDate: "2026-07-02",
        opposition: "First CC",
      });

      await expect(
        createMatchday(ctx.db)(userId, "admin", {
          teamId,
          matchDate: "2026-07-02",
          opposition: "Second CC",
        }),
      ).rejects.toThrow("already exists");
    });
  });

  describe("addPlayer / removePlayer", () => {
    it("adds and removes a member player", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `addplayer-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });
      const memberId = await seedMember(
        "Test Player",
        `tp-${crypto.randomUUID()}@test.com`,
      );

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Test Player" },
      );
      expect(playerId).toBeDefined();

      // Verify player exists
      const players = await ctx.db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .selectAll()
        .execute();
      expect(players).toHaveLength(1);
      expect(players[0].player_name).toBe("Test Player");

      // Remove
      const result = await removePlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        playerId,
      );
      expect(result.success).toBe(true);

      const remaining = await ctx.db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .selectAll()
        .execute();
      expect(remaining).toHaveLength(0);
    });

    it("adds an ad-hoc player (creates guest member)", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `adhoc-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { playerName: "Guest Player" },
      );
      expect(playerId).toBeDefined();

      // Should have created a guest member
      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      const memberId = player?.member_id;
      expect(memberId).toBeDefined();

      if (memberId) {
        const member = await ctx.db
          .selectFrom("member")
          .where("id", "=", memberId)
          .selectAll()
          .executeTakeFirst();
        expect(member?.member_category).toBe("guest");
      }
    });
  });

  describe("searchMembers", () => {
    it("finds members by name (case insensitive)", async () => {
      const name = `SearchTest-${crypto.randomUUID().slice(0, 6)}`;
      await seedMember(name, `${name.toLowerCase()}@test.com`);

      const result = await searchMembers(ctx.db)({ query: name.slice(0, 8) });
      expect(result.some((m) => m.name === name)).toBe(true);
    });
  });

  describe("confirmTeam with fee generation", () => {
    it("confirms team and generates match fees", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `confirm-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });
      const memberId = await seedMember(
        "Fee Player",
        `fee-${crypto.randomUUID()}@test.com`,
        "senior",
      );

      // Add a fee rate for seniors
      await seedFeeRate({ memberCategory: "senior", amountPence: 500 });

      // Add player
      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Fee Player" },
      );

      // Confirm with player as "playing"
      await confirmTeam(ctx.db)(userId, "admin", matchdayId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });

      // Verify matchday is confirmed
      const md = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(md?.status).toBe("confirmed");

      // Verify charge was created
      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      const chargeId = player?.charge_id;
      expect(chargeId).toBeDefined();

      if (chargeId) {
        const charge = await ctx.db
          .selectFrom("charge")
          .where("id", "=", chargeId)
          .selectAll()
          .executeTakeFirst();
        expect(charge?.amount_pence).toBe(500);
        expect(charge?.type).toBe("match_fee");
      }
    });
  });

  describe("getMatch (enriched)", () => {
    it("returns matchday with players, expenses, and team", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `getmatch-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const result = await getMatch(ctx.db)(userId, "admin", matchdayId);

      expect(result.matchday.id).toBe(matchdayId);
      expect(result.team).toBeTruthy();
      expect(result.players).toBeDefined();
      expect(result.expenses).toBeDefined();
    });
  });

  describe("recordExpense / deleteExpense", () => {
    it("creates and then deletes an expense record", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `expense-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchId = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "confirmed",
      });

      // Record expense
      const { expenseId } = await recordExpense(ctx.db)(userId, "admin", {
        matchId,
        type: "umpire_fee",
        description: "Umpire payment",
        amountPence: 5000,
      });

      // Verify it exists
      const row = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(row).toBeTruthy();
      expect(row?.expense_type).toBe("umpire_fee");
      expect(row?.amount_pence).toBe(5000);

      // Delete
      const deleteResult = await deleteExpense(ctx.db)(
        userId,
        "admin",
        expenseId,
      );
      expect(deleteResult.success).toBe(true);

      // Verify deletion
      const deleted = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(deleted).toBeUndefined();
    });
  });
});
