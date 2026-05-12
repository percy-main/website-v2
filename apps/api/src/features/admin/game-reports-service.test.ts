import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder: Record<string, unknown> = {
      selectFrom: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    };

    return {
      mockExecuteTakeFirst,
      mockExecute,
      mockQueryBuilder,
    };
  },
);

import { getMatchdayReport, listGameReports } from "./game-reports-service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("game-reports-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const value = mockQueryBuilder[key];
      if (typeof value === "function" && "mockReturnThis" in value) {
        (value as ReturnType<typeof vi.fn>).mockReturnThis();
      }
    }
  });

  describe("listGameReports", () => {
    it("returns matchdays and total count", async () => {
      const matchdays = [
        {
          id: "m1",
          match_date: "2026-06-15",
          opposition: "Benwell",
          status: "confirmed",
          play_cricket_team_id: "t1",
          competition_type: "League",
          team_name: "1st XI",
        },
      ];

      // First call: matchdays query
      mockExecute.mockResolvedValueOnce(matchdays);
      // Second call: count query
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: "1" });

      const result = await listGameReports(db)({
        limit: 50,
        offset: 0,
      });

      expect(result.matchdays).toEqual(matchdays);
      expect(result.total).toBe(1);
    });

    it("filters by teamId when provided", async () => {
      mockExecute.mockResolvedValueOnce([]);
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: "0" });

      const result = await listGameReports(db)({
        teamId: "t1",
        limit: 50,
        offset: 0,
      });

      expect(result.matchdays).toEqual([]);
      expect(result.total).toBe(0);
      // where should have been called for teamId filter
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it("returns 0 total when no count row", async () => {
      mockExecute.mockResolvedValueOnce([]);
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      const result = await listGameReports(db)({
        limit: 50,
        offset: 0,
      });

      expect(result.total).toBe(0);
    });
  });

  describe("getMatchdayReport", () => {
    it("throws 404 when matchday not found", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(getMatchdayReport(db)("nonexistent")).rejects.toThrow(
        "Matchday not found",
      );
    });

    it("returns full report with financial summary", async () => {
      // Matchday
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "m1",
        match_date: "2026-06-15",
        opposition: "Benwell",
        status: "confirmed",
        play_cricket_team_id: "t1",
        play_cricket_match_id: null,
        competition_type: "League",
      });

      // Players
      mockExecute.mockResolvedValueOnce([
        {
          id: "p1",
          player_name: "John Smith",
          status: "playing",
          member_id: "mem1",
          member_category: "senior",
          charge_amount_pence: 1000,
          charge_paid_at: "2026-06-15",
          charge_payment_method: "card",
          charge_deleted_at: null,
          charge_payment_confirmed_at: null,
          charge_stripe_payment_intent_id: null,
          charge_created_at: "2026-06-15",
          charge_relieved_at: null,
        },
        {
          id: "p2",
          player_name: "Bob Jones",
          status: "playing",
          member_id: "mem2",
          member_category: "senior",
          charge_amount_pence: 1000,
          charge_paid_at: null,
          charge_payment_method: null,
          charge_deleted_at: null,
          charge_payment_confirmed_at: null,
          charge_stripe_payment_intent_id: null,
          charge_created_at: "2026-06-15",
          charge_relieved_at: null,
        },
      ]);

      // Expenses
      mockExecute.mockResolvedValueOnce([
        {
          id: "e1",
          expense_type: "umpire_fee",
          description: null,
          amount_pence: 500,
        },
      ]);

      // Team
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "t1",
        name: "1st XI",
      });

      const result = await getMatchdayReport(db)("m1");

      expect(result.matchday.id).toBe("m1");
      expect(result.team?.name).toBe("1st XI");
      expect(result.players).toHaveLength(2);
      expect(result.expenses).toHaveLength(1);
      expect(result.sponsorship).toBeNull();

      // Financial summary
      expect(result.summary.totalIncoming).toBe(2000);
      expect(result.summary.totalPaid).toBe(1000);
      expect(result.summary.totalPending).toBe(0);
      expect(result.summary.totalOutstanding).toBe(1000);
      expect(result.summary.totalExpenses).toBe(500);
      expect(result.summary.sponsorshipIncome).toBe(0);
      expect(result.summary.profitLoss).toBe(1500); // 2000 + 0 - 500
    });

    it("includes sponsorship when play_cricket_match_id exists", async () => {
      // Matchday with play_cricket_match_id
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "m1",
        match_date: "2026-06-15",
        opposition: "Benwell",
        status: "confirmed",
        play_cricket_team_id: "t1",
        play_cricket_match_id: "pc123",
        competition_type: "League",
      });

      // Players (none)
      mockExecute.mockResolvedValueOnce([]);

      // Expenses (none)
      mockExecute.mockResolvedValueOnce([]);

      // Team
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "t1",
        name: "1st XI",
      });

      // Sponsorship
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "s1",
        sponsor_name: "Local Pub",
        amount_pence: 5000,
      });

      const result = await getMatchdayReport(db)("m1");

      expect(result.sponsorship).not.toBeNull();
      expect(result.summary.sponsorshipIncome).toBe(5000);
      expect(result.summary.profitLoss).toBe(5000); // 0 + 5000 - 0
    });

    it("excludes deleted charges from financial summary", async () => {
      // Matchday
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "m1",
        match_date: "2026-06-15",
        opposition: "Benwell",
        status: "confirmed",
        play_cricket_team_id: "t1",
        play_cricket_match_id: null,
        competition_type: null,
      });

      // Players - one with deleted charge
      mockExecute.mockResolvedValueOnce([
        {
          id: "p1",
          player_name: "John Smith",
          status: "playing",
          member_id: "mem1",
          member_category: "senior",
          charge_amount_pence: 1000,
          charge_paid_at: null,
          charge_payment_method: null,
          charge_deleted_at: "2026-06-16",
          charge_payment_confirmed_at: null,
          charge_stripe_payment_intent_id: null,
          charge_created_at: "2026-06-15",
          charge_relieved_at: null,
        },
      ]);

      // Expenses
      mockExecute.mockResolvedValueOnce([]);

      // Team
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "t1",
        name: "1st XI",
      });

      const result = await getMatchdayReport(db)("m1");

      // Deleted charge should be excluded
      expect(result.summary.totalIncoming).toBe(0);
      expect(result.summary.totalPaid).toBe(0);
    });

    it("excludes relieved charges from financial summary and reports relieved status", async () => {
      // Matchday
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "m1",
        match_date: "2026-06-15",
        opposition: "Benwell",
        status: "confirmed",
        play_cricket_team_id: "t1",
        play_cricket_match_id: null,
        competition_type: null,
      });

      // Players: one paid, one relieved (waived under a financial-relief grant)
      mockExecute.mockResolvedValueOnce([
        {
          id: "p1",
          player_name: "John Smith",
          status: "playing",
          member_id: "mem1",
          member_category: "senior",
          charge_amount_pence: 1000,
          charge_paid_at: "2026-06-15",
          charge_payment_method: "card",
          charge_deleted_at: null,
          charge_payment_confirmed_at: null,
          charge_stripe_payment_intent_id: null,
          charge_created_at: "2026-06-15",
          charge_relieved_at: null,
        },
        {
          id: "p2",
          player_name: "Bob Jones",
          status: "playing",
          member_id: "mem2",
          member_category: "senior",
          charge_amount_pence: 1000,
          charge_paid_at: null,
          charge_payment_method: null,
          charge_deleted_at: null,
          charge_payment_confirmed_at: null,
          charge_stripe_payment_intent_id: null,
          charge_created_at: "2026-06-15",
          charge_relieved_at: "2026-06-16",
        },
      ]);

      // Expenses
      mockExecute.mockResolvedValueOnce([]);

      // Team
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "t1",
        name: "1st XI",
      });

      const result = await getMatchdayReport(db)("m1");

      expect(result.players[0].charge_status).toBe("paid");
      expect(result.players[1].charge_status).toBe("relieved");

      // Only the paid charge contributes to incoming; relieved charge is waived
      expect(result.summary.totalIncoming).toBe(1000);
      expect(result.summary.totalPaid).toBe(1000);
      expect(result.summary.totalOutstanding).toBe(0);
    });
  });
});
