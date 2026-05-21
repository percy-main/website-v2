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

import { noopS3Uploader } from "../../lib/s3-upload.ts";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  addPlayer,
  approveExpense,
  createMatchday,
  deleteExpense,
  finishMatch,
  listMatches,
  listTeams,
  markExpenseReimbursed,
  recordExpense,
  rejectExpense,
  removePlayer,
  searchMembers,
  submitExpenseClaim,
} from "./service.ts";

const log = createNoopLogger();

const db = mockQueryBuilder as unknown as Kysely<DB>;
const s3 = noopS3Uploader;

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
    it("returns both members and dependents with a type discriminator", async () => {
      const members = [
        { id: "m1", name: "John", email: "j@t.com", member_category: "senior" },
      ];
      const dependents = [{ id: "d1", name: "Johnny", parent_name: "Parent" }];
      // searchMembers fires two queries in parallel; mockResolvedValueOnce
      // honours call order regardless of which promise resolves first.
      mockExecute.mockResolvedValueOnce(members);
      mockExecute.mockResolvedValueOnce(dependents);

      const result = await searchMembers(db)({ query: "John" });
      expect(result).toEqual([
        { type: "member", ...members[0] },
        { type: "dependent", ...dependents[0] },
      ]);
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
      const todayIso = new Date().toISOString().slice(0, 10);
      // Matchday lookup
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "m-1",
        play_cricket_team_id: "t1",
        status: "pending",
        match_date: todayIso,
      });
      // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce([{ id: "t1" }]);
      // Insert
      mockExecute.mockResolvedValueOnce([]);

      const result = await recordExpense(db, s3)("user-1", "admin", {
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

describe("expense approval workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
    // The for-loop above resets `transaction` to return mockQueryBuilder,
    // which makes `db.transaction().execute(cb)` short-circuit through
    // mockExecute without ever running `cb`. Restore the callback-running
    // shape so finishMatch's transactional writes actually fire.
    mockQueryBuilder.transaction.mockReturnValue({
      execute: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) =>
        cb(mockQueryBuilder),
      ),
    });
  });

  describe("submitExpenseClaim", () => {
    it("creates a submitted expense", async () => {
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

      const result = await submitExpenseClaim(db, s3)("user-1", "admin", {
        matchId: "m-1",
        type: "umpire_fee",
        amountPence: 5000,
      });

      expect(result.expenseId).toBeDefined();
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "matchday_expense",
      );
    });
  });

  describe("approveExpense", () => {
    it("approves a submitted expense", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "exp-1",
        status: "submitted",
      });
      mockExecute.mockResolvedValueOnce([]);

      const result = await approveExpense(db)("admin-1", "exp-1");
      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "approved" }),
      );
    });

    it("rejects approval of non-submitted expense", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "exp-1",
        status: "draft",
      });

      await expect(approveExpense(db)("admin-1", "exp-1")).rejects.toThrow(
        "Only submitted expenses can be approved",
      );
    });
  });

  describe("rejectExpense", () => {
    it("rejects a submitted expense with reason", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "exp-1",
        status: "submitted",
      });
      mockExecute.mockResolvedValueOnce([]);

      const result = await rejectExpense(db)("admin-1", "exp-1", {
        reason: "Missing details",
      });
      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "rejected",
          rejected_reason: "Missing details",
        }),
      );
    });
  });

  describe("markExpenseReimbursed", () => {
    it("marks an approved expense as reimbursed", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "exp-1",
        status: "approved",
      });
      mockExecute.mockResolvedValueOnce([]);

      const result = await markExpenseReimbursed(db)("admin-1", "exp-1");
      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "reimbursed" }),
      );
    });

    it("rejects reimbursement of non-approved expense", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "exp-1",
        status: "submitted",
      });

      await expect(
        markExpenseReimbursed(db)("admin-1", "exp-1"),
      ).rejects.toThrow("Only approved expenses can be reimbursed");
    });
  });

  describe("finishMatch", () => {
    const mockSendEmail = vi.fn().mockResolvedValue(undefined);
    const mockConfig = { BASE_URL: "https://example.com" };
    const finish = finishMatch(db, mockSendEmail, mockConfig);

    it("rejects if matchday not found", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        finish(
          "user-1",
          "admin",
          "match-1",
          { resultType: "W", playerStatuses: [], feeOverrides: [] },
          log,
        ),
      ).rejects.toThrow("Matchday not found");
    });

    it("rejects if matchday is cancelled", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "match-1",
        status: "cancelled",
        play_cricket_team_id: "team-1",
      });
      // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce([{ id: "team-1" }]);

      await expect(
        finish(
          "user-1",
          "admin",
          "match-1",
          { resultType: "W", playerStatuses: [], feeOverrides: [] },
          log,
        ),
      ).rejects.toThrow("Cannot finish a cancelled matchday");
    });

    it("rejects if user has no access to the matchday team", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "match-1",
        status: "confirmed",
        play_cricket_team_id: "team-1",
      });
      // getAccessibleTeamIds returns empty (no access)
      mockExecute.mockResolvedValueOnce([]);

      await expect(
        finish(
          "user-1",
          "admin",
          "match-1",
          { resultType: "W", playerStatuses: [], feeOverrides: [] },
          log,
        ),
      ).rejects.toThrow("You do not have access to this matchday");
    });

    it("persists result when finishing a confirmed matchday", async () => {
      // getMatch - matchday lookup
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "match-1",
        status: "confirmed",
        play_cricket_team_id: "team-1",
        opposition: "Test CC",
        match_date: "2026-03-20",
        finished_at: null,
        finished_by: null,
      });
      // getAccessibleTeamIds - admin gets all teams
      mockExecute.mockResolvedValueOnce([{ id: "team-1" }]);
      // upfront fee-validation: players + fee rates
      mockExecute.mockResolvedValueOnce([]);
      mockExecute.mockResolvedValueOnce([]);
      // update matchday
      mockExecute.mockResolvedValueOnce([]);
      // flip any leftover "selected" players to "playing"
      mockExecute.mockResolvedValueOnce([]);
      // submit draft expenses
      mockExecute.mockResolvedValueOnce([]);
      // uncharged players query
      mockExecute.mockResolvedValueOnce([]);
      // unpaid players query
      mockExecute.mockResolvedValueOnce([]);

      const result = await finish(
        "user-1",
        "admin",
        "match-1",
        {
          resultType: "W",
          playerStatuses: [],
          feeOverrides: [],
        },
        log,
      );

      expect(result.success).toBe(true);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "finished",
          result_type: "W",
          result_source: "manual",
        }),
      );
    });

    it("allows re-submitting result on already-finished matchday", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "match-1",
        status: "finished",
        play_cricket_team_id: "team-1",
        opposition: "Test CC",
        match_date: "2026-03-20",
        finished_at: "2026-03-20T18:00:00.000Z",
        finished_by: "user-1",
      });
      // getAccessibleTeamIds
      mockExecute.mockResolvedValueOnce([{ id: "team-1" }]);
      // update matchday
      mockExecute.mockResolvedValueOnce([]);

      const result = await finish(
        "user-1",
        "admin",
        "match-1",
        {
          resultType: "L",
          playerStatuses: [],
          feeOverrides: [],
        },
        log,
      );

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBe(0);
      // Should preserve original finished_at/finished_by
      expect(mockQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          finished_at: "2026-03-20T18:00:00.000Z",
          finished_by: "user-1",
          result_type: "L",
        }),
      );
    });
  });
});
