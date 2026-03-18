import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import { getMatchdayReport, listGameReports } from "./game-reports-service.js";

let ctx: TestContext;
let defaultUserId: string;
beforeAll(async () => {
  ctx = await startTestContainer();
  // Seed a shared user for FK references (matchday.created_by, etc.)
  const user = await seedTestUser(ctx.db, { withMember: true, role: "admin" });
  defaultUserId = user.userId;
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

/** Seeds a play_cricket_team and returns its id. */
async function seedTeam(
  db: Kysely<DB>,
  overrides: { id?: string; name?: string } = {},
) {
  const id = overrides.id ?? `team-${crypto.randomUUID()}`;
  await db
    .insertInto("play_cricket_team")
    .values({
      id,
      name: overrides.name ?? "Test XI",
      site_id: "test-site",
    })
    .execute();
  return id;
}

/** Seeds a matchday and returns its id. */
async function seedMatchday(
  db: Kysely<DB>,
  teamId: string,
  overrides: {
    id?: string;
    matchDate?: string;
    opposition?: string;
    status?: string;
    competitionType?: string | null;
    playCricketMatchId?: string | null;
    createdBy?: string;
  } = {},
) {
  const id = overrides.id ?? `matchday-${crypto.randomUUID()}`;
  await db
    .insertInto("matchday")
    .values({
      id,
      play_cricket_team_id: teamId,
      match_date: overrides.matchDate ?? "2026-06-15",
      opposition: overrides.opposition ?? "Benwell CC",
      status: overrides.status ?? "confirmed",
      competition_type: overrides.competitionType ?? null,
      play_cricket_match_id: overrides.playCricketMatchId ?? null,
      created_by: overrides.createdBy ?? defaultUserId,
    })
    .execute();
  return id;
}

/** Seeds a member and returns its id. */
async function seedMember(db: Kysely<DB>, name: string) {
  const id = `member-${crypto.randomUUID()}`;
  await db
    .insertInto("member")
    .values({ id, email: `${id}@test.com`, name })
    .execute();
  return id;
}

/** Seeds a matchday player (optionally with a charge). */
async function seedPlayer(
  db: Kysely<DB>,
  matchdayId: string,
  overrides: {
    playerName?: string;
    status?: string;
    memberId?: string | null;
    chargeAmountPence?: number | null;
    chargePaidAt?: string | null;
    chargePaymentMethod?: string | null;
    chargeDeletedAt?: string | null;
  } = {},
) {
  const playerId = `player-${crypto.randomUUID()}`;
  let chargeId: string | null = null;

  if (overrides.chargeAmountPence != null) {
    // Charges require a valid member_id FK — seed one if not provided
    const chargeMemberId =
      overrides.memberId ??
      (await seedMember(db, overrides.playerName ?? "Test Player"));

    chargeId = `charge-${crypto.randomUUID()}`;
    await db
      .insertInto("charge")
      .values({
        id: chargeId,
        member_id: chargeMemberId,
        description: "Match fee",
        amount_pence: overrides.chargeAmountPence,
        charge_date: "2026-06-15",
        created_by: defaultUserId,
        paid_at: overrides.chargePaidAt ?? null,
        payment_method: overrides.chargePaymentMethod ?? null,
        deleted_at: overrides.chargeDeletedAt ?? null,
      })
      .execute();
  }

  await db
    .insertInto("matchday_player")
    .values({
      id: playerId,
      matchday_id: matchdayId,
      player_name: overrides.playerName ?? "Test Player",
      status: overrides.status ?? "playing",
      member_id: overrides.memberId ?? null,
      charge_id: chargeId,
    })
    .execute();

  return playerId;
}

/** Seeds a matchday expense. */
async function seedExpense(
  db: Kysely<DB>,
  matchdayId: string,
  overrides: {
    expenseType?: string;
    amountPence?: number;
    description?: string | null;
    createdBy?: string;
  } = {},
) {
  const id = `expense-${crypto.randomUUID()}`;
  await db
    .insertInto("matchday_expense")
    .values({
      id,
      matchday_id: matchdayId,
      expense_type: overrides.expenseType ?? "umpire_fee",
      amount_pence: overrides.amountPence ?? 4000,
      description: overrides.description ?? null,
      created_by: overrides.createdBy ?? defaultUserId,
    })
    .execute();
  return id;
}

describe("game-reports-service (integration)", () => {
  describe("listGameReports", () => {
    it("returns matchdays ordered by date descending", async () => {
      const teamId = await seedTeam(ctx.db, { name: "1st XI" });
      await seedMatchday(ctx.db, teamId, {
        matchDate: "2026-06-10",
        opposition: "Team A",
      });
      await seedMatchday(ctx.db, teamId, {
        matchDate: "2026-06-20",
        opposition: "Team B",
      });

      const result = await listGameReports(ctx.db)({
        limit: 50,
        offset: 0,
      });

      expect(result.total).toBeGreaterThanOrEqual(2);
      // Most recent first
      const teamMatchdays = result.matchdays.filter(
        (m) => m.play_cricket_team_id === teamId,
      );
      expect(teamMatchdays[0]?.opposition).toBe("Team B");
      expect(teamMatchdays[1]?.opposition).toBe("Team A");
    });

    it("filters by teamId", async () => {
      const teamA = await seedTeam(ctx.db, { name: "Team A" });
      const teamB = await seedTeam(ctx.db, { name: "Team B" });
      await seedMatchday(ctx.db, teamA, { opposition: "Opponent A" });
      await seedMatchday(ctx.db, teamB, { opposition: "Opponent B" });

      const result = await listGameReports(ctx.db)({
        teamId: teamA,
        limit: 50,
        offset: 0,
      });

      expect(
        result.matchdays.every((m) => m.play_cricket_team_id === teamA),
      ).toBe(true);
    });

    it("joins team name", async () => {
      const teamId = await seedTeam(ctx.db, { name: "Percy Main 2nd XI" });
      await seedMatchday(ctx.db, teamId);

      const result = await listGameReports(ctx.db)({
        teamId,
        limit: 50,
        offset: 0,
      });

      expect(result.matchdays[0]?.team_name).toBe("Percy Main 2nd XI");
    });
  });

  describe("getMatchdayReport", () => {
    it("throws 404 for missing matchday", async () => {
      await expect(getMatchdayReport(ctx.db)("nonexistent-id")).rejects.toThrow(
        "Matchday not found",
      );
    });

    it("returns financial summary with correct calculations", async () => {
      const teamId = await seedTeam(ctx.db);
      const user = await seedTestUser(ctx.db, {
        withMember: true,
        role: "admin",
      });
      const matchdayId = await seedMatchday(ctx.db, teamId, {
        createdBy: user.userId,
      });

      // Two players: one paid (1000p), one outstanding (1000p)
      await seedPlayer(ctx.db, matchdayId, {
        playerName: "Paid Player",
        memberId: user.memberId,
        chargeAmountPence: 1000,
        chargePaidAt: "2026-06-15T12:00:00Z",
        chargePaymentMethod: "card",
      });
      await seedPlayer(ctx.db, matchdayId, {
        playerName: "Unpaid Player",
        chargeAmountPence: 1000,
      });

      // One expense (500p)
      await seedExpense(ctx.db, matchdayId, {
        amountPence: 500,
        createdBy: user.userId,
      });

      const report = await getMatchdayReport(ctx.db)(matchdayId);

      expect(report.matchday.id).toBe(matchdayId);
      expect(report.team).not.toBeNull();
      expect(report.players).toHaveLength(2);
      expect(report.expenses).toHaveLength(1);
      expect(report.sponsorship).toBeNull();

      expect(report.summary.totalIncoming).toBe(2000);
      expect(report.summary.totalPaid).toBe(1000);
      expect(report.summary.totalOutstanding).toBe(1000);
      expect(report.summary.totalExpenses).toBe(500);
      expect(report.summary.sponsorshipIncome).toBe(0);
      expect(report.summary.profitLoss).toBe(1500);
    });

    it("excludes deleted charges from totals", async () => {
      const teamId = await seedTeam(ctx.db);
      const matchdayId = await seedMatchday(ctx.db, teamId);

      // Player with deleted charge
      await seedPlayer(ctx.db, matchdayId, {
        playerName: "Deleted Charge Player",
        chargeAmountPence: 1000,
        chargeDeletedAt: "2026-06-16T00:00:00Z",
      });

      const report = await getMatchdayReport(ctx.db)(matchdayId);

      expect(report.summary.totalIncoming).toBe(0);
      expect(report.summary.totalPaid).toBe(0);
    });

    it("includes sponsorship income when available", async () => {
      const teamId = await seedTeam(ctx.db);
      const playCricketMatchId = `pc-${crypto.randomUUID()}`;
      const matchdayId = await seedMatchday(ctx.db, teamId, {
        playCricketMatchId,
      });

      // Seed approved, paid sponsorship
      await ctx.db
        .insertInto("game_sponsorship")
        .values({
          id: `gs-${crypto.randomUUID()}`,
          game_id: playCricketMatchId,
          sponsor_name: "Local Pub",
          sponsor_email: "pub@example.com",
          amount_pence: 5000,
          approved: true,
          paid_at: "2026-06-15T10:00:00Z",
        })
        .execute();

      const report = await getMatchdayReport(ctx.db)(matchdayId);

      expect(report.sponsorship).not.toBeNull();
      expect(report.sponsorship?.sponsor_name).toBe("Local Pub");
      expect(report.summary.sponsorshipIncome).toBe(5000);
      expect(report.summary.profitLoss).toBe(5000);
    });
  });
});
