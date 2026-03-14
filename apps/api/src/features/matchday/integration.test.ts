import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  seedTestUser,
  type TestContext,
} from "../../test/containers.js";
import { listMatches, recordExpense, deleteExpense } from "./service.js";

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

      const matchA = await seedMatchday({ teamId: teamA, createdBy: officialId });
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

  describe("recordExpense / deleteExpense", () => {
    it("creates and then deletes an expense record", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `expense-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchId = await seedMatchday({ teamId, createdBy: userId });

      // Record expense
      const { expenseId } = await recordExpense(ctx.db)(userId, {
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
      const deleteResult = await deleteExpense(ctx.db)(userId, expenseId);
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
