import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      deleteFrom: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

vi.mock("@percy-main/db", () => ({
  client: new Proxy(mockQueryBuilder, {
    get(target, prop) {
      if (prop in target) {
        return (target as Record<string | symbol, unknown>)[prop];
      }
      return vi.fn().mockReturnValue(target);
    },
  }),
}));

import {
  listMatches,
  recordExpense,
  deleteExpense,
} from "./service.js";

describe("matchday service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
  });

  describe("listMatches", () => {
    it("returns matches for admin without team filter", async () => {
      const matches = [
        { id: "m1", match_date: "2026-03-14" },
        { id: "m2", match_date: "2026-03-07" },
      ];
      mockExecute.mockResolvedValue(matches);

      const result = await listMatches("user-1", "admin", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      expect(result.items).toEqual(matches);
      // Admin should not trigger innerJoin for team_official
      expect(mockQueryBuilder.innerJoin).not.toHaveBeenCalled();
    });

    it("filters by team for officials", async () => {
      mockExecute.mockResolvedValue([]);

      await listMatches("user-1", "official", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      // Official should trigger innerJoin for team_official
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        "team_official",
        "team_official.play_cricket_team_id",
        "matchday.play_cricket_team_id",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "team_official.user_id",
        "=",
        "user-1",
      );
    });
  });

  describe("recordExpense", () => {
    it("creates expense record and returns id", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await recordExpense("user-1", {
        matchId: "m-1",
        type: "umpire_fee",
        amountPence: 5000,
      });

      expect(result.expenseId).toBeDefined();
      expect(typeof result.expenseId).toBe("string");
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "matchday_expense",
      );
    });
  });

  describe("deleteExpense", () => {
    it("removes expense record", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await deleteExpense("user-1", "exp-1");

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.deleteFrom).toHaveBeenCalledWith(
        "matchday_expense",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "id",
        "=",
        "exp-1",
      );
    });
  });
});
