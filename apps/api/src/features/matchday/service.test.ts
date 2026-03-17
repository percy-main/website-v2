import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockExecuteTakeFirst, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      deleteFrom: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) =>
          cb(mockQueryBuilder),
        ),
      }),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

import {
  addPlayer,
  createMatchday,
  deleteExpense,
  listMatches,
  listTeams,
  recordExpense,
  removePlayer,
  searchMembers,
} from "./service.js";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("matchday service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
    // Reset transaction mock
    mockQueryBuilder.transaction.mockReturnValue({
      execute: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) =>
        cb(mockQueryBuilder),
      ),
    });
  });

  describe("listMatches", () => {
    it("returns matches for admin without team filter", async () => {
      const matches = [
        { id: "m1", match_date: "2026-03-14" },
        { id: "m2", match_date: "2026-03-07" },
      ];
      mockExecute.mockResolvedValue(matches);

      const result = await listMatches(db)("user-1", "admin", {
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

      await listMatches(db)("user-1", "official", {
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

  describe("listTeams", () => {
    it("returns all teams for admin", async () => {
      const teams = [{ id: "t1", name: "1st XI", is_junior: false }];
      mockExecute.mockResolvedValueOnce(teams); // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce(teams); // selectFrom play_cricket_team

      const result = await listTeams(db)("user-1", "admin");
      expect(result).toEqual(teams);
    });

    it("returns empty for official with no teams", async () => {
      mockExecute.mockResolvedValueOnce([]); // getAccessibleTeamIds (team_official)

      const result = await listTeams(db)("user-1", "official");
      expect(result).toEqual([]);
    });
  });

  describe("searchMembers", () => {
    it("searches members by name", async () => {
      const members = [
        { id: "m1", name: "John", email: "j@t.com", member_category: "senior" },
      ];
      mockExecute.mockResolvedValue(members);

      const result = await searchMembers(db)({ query: "John" });
      expect(result).toEqual(members);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "name",
        "ilike",
        "%John%",
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(20);
    });
  });

  describe("createMatchday", () => {
    it("creates a matchday for accessible team", async () => {
      // getAccessibleTeamIds returns the team
      mockExecute.mockResolvedValueOnce([{ id: "t1" }]);
      // No existing matchday
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      // Insert
      mockExecute.mockResolvedValueOnce([]);

      const result = await createMatchday(db)("user-1", "admin", {
        teamId: "t1",
        matchDate: "2026-06-15",
        opposition: "Test CC",
      });

      expect(result.id).toBeDefined();
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("matchday");
    });
  });

  describe("addPlayer", () => {
    it("adds a member player to a pending matchday", async () => {
      // getMatchday
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "md1",
        play_cricket_team_id: "t1",
        status: "pending",
      });
      // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce([{ id: "t1" }]);
      // Duplicate check
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
      // Transaction inserts
      mockExecute.mockResolvedValue([]);

      const result = await addPlayer(db)("user-1", "admin", "md1", {
        memberId: "member-1",
        playerName: "Test Player",
      });

      expect(result.id).toBeDefined();
    });
  });

  describe("removePlayer", () => {
    it("removes a player from a pending matchday", async () => {
      // Player lookup
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "p1",
        play_cricket_team_id: "t1",
        matchday_status: "pending",
      });
      // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce([{ id: "t1" }]);
      // Delete
      mockExecute.mockResolvedValueOnce([]);

      const result = await removePlayer(db)("user-1", "admin", "md1", "p1");
      expect(result.success).toBe(true);
      expect(mockQueryBuilder.deleteFrom).toHaveBeenCalledWith(
        "matchday_player",
      );
    });
  });

  describe("recordExpense", () => {
    it("creates expense record and returns id", async () => {
      // Matchday lookup
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "m-1",
        play_cricket_team_id: "t1",
        status: "confirmed",
      });
      // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce([{ id: "t1" }]);
      // Insert
      mockExecute.mockResolvedValueOnce([]);

      const result = await recordExpense(db)("user-1", "admin", {
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
      // Expense lookup
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "exp-1",
        play_cricket_team_id: "t1",
        matchday_status: "confirmed",
      });
      // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce([{ id: "t1" }]);
      // Delete
      mockExecute.mockResolvedValueOnce([]);

      const result = await deleteExpense(db)("user-1", "admin", "exp-1");

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.deleteFrom).toHaveBeenCalledWith(
        "matchday_expense",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", "=", "exp-1");
    });
  });
});
