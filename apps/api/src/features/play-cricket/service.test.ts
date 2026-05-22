import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import assert from "node:assert/strict";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      distinct: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

vi.mock("kysely", () => ({
  sql: new Proxy(() => ({ as: () => "sql_expr" }), {
    get() {
      return () => ({ as: () => "sql_expr" });
    },
    apply() {
      return { as: () => "sql_expr" };
    },
  }),
}));

vi.mock("./api-client.js", () => ({
  getMatchDetail: vi.fn(),
  getLeagueTable: vi.fn(),
}));

import { getMatchDetail as apiGetMatchDetail } from "./api-client.ts";
import { getMatchDetail, getPlayerCareerStats, getTeams } from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("play-cricket service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const fn = mockQueryBuilder[key as keyof typeof mockQueryBuilder];
      if (typeof fn === "function" && "mockReturnValue" in fn) {
        if (key === "executeTakeFirst") {
          mockExecuteTakeFirst.mockResolvedValue(undefined);
        } else if (key === "execute") {
          mockExecute.mockResolvedValue([]);
        } else {
          (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
        }
      }
    }
  });

  describe("getTeams", () => {
    it("returns teams from database", async () => {
      const teamData = [
        { id: "t1", name: "1st XI", is_junior: false },
        { id: "t2", name: "2nd XI", is_junior: false },
      ];
      mockExecute.mockResolvedValueOnce(teamData);

      const result = await getTeams(db)();

      expect(result.teams).toEqual(teamData);
      expect(mockQueryBuilder.selectFrom).toHaveBeenCalledWith(
        "play_cricket_team",
      );
    });

    it("returns empty array when no teams exist", async () => {
      mockExecute.mockResolvedValueOnce([]);

      const result = await getTeams(db)();

      expect(result.teams).toEqual([]);
    });
  });

  describe("getMatchDetail", () => {
    it("returns cached data when fresh", async () => {
      const cachedData = { match_id: "123", innings: [] };
      mockExecuteTakeFirst.mockResolvedValueOnce({
        match_id: "123",
        data: JSON.stringify(cachedData),
        fetched_at: new Date().toISOString(), // Just now = still fresh
      });

      const result: unknown = await getMatchDetail(db)("123");

      expect(result).toEqual(cachedData);
      // Should NOT have called the API
      expect(apiGetMatchDetail).not.toHaveBeenCalled();
    });

    it("fetches from API when cache is stale", async () => {
      const staleDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      mockExecuteTakeFirst.mockResolvedValueOnce({
        match_id: "123",
        data: JSON.stringify({ old: true }),
        fetched_at: staleDate.toISOString(),
      });

      const freshData = { match_id: "123", innings: [{ runs: 200 }] };
      (apiGetMatchDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        freshData,
      );

      // Mock the update
      mockExecute.mockResolvedValueOnce([]);

      const result: unknown = await getMatchDetail(db)("123");

      expect(result).toEqual(freshData);
      expect(apiGetMatchDetail).toHaveBeenCalledWith("123");
    });

    it("fetches from API when no cache exists", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // No cache

      const apiData = { match_id: "456", innings: [] };
      (apiGetMatchDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        apiData,
      );

      // Mock the insert
      mockExecute.mockResolvedValueOnce([]);

      const result: unknown = await getMatchDetail(db)("456");

      expect(result).toEqual(apiData);
      expect(apiGetMatchDetail).toHaveBeenCalledWith("456");
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "play_cricket_match_cache",
      );
    });
  });

  describe("getPlayerCareerStats", () => {
    it("returns null when no slug link exists", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // No member found

      const result = await getPlayerCareerStats(db)("entry-123");

      expect(result).toBeNull();
    });

    it("returns null when member has no play_cricket_id", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        play_cricket_id: null,
      });

      const result = await getPlayerCareerStats(db)("entry-123");

      expect(result).toBeNull();
    });

    it("returns career stats partitioned by game_type, hardball only", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        play_cricket_id: "pc-100",
      });

      // Batting aggregated by (season, game_type). Hardball rows only —
      // dismissal_penalty is 0 so the unified average collapses to
      // runs / times_out.
      mockExecute.mockResolvedValueOnce([
        {
          season: 2024,
          game_type: "Standard",
          innings: "10",
          total_runs: "350",
          high_score: "85",
          total_times_out: "8",
          not_outs: "2",
          total_penalty_runs: "0",
          total_balls: "300",
          total_fours: "30",
          total_sixes: "5",
          fifties: "3",
          hundreds: "0",
        },
        {
          season: 2023,
          game_type: "Standard",
          innings: "8",
          total_runs: "200",
          high_score: "62",
          total_times_out: "7",
          not_outs: "1",
          total_penalty_runs: "0",
          total_balls: "200",
          total_fours: "15",
          total_sixes: "2",
          fifties: "1",
          hundreds: "0",
        },
      ]);

      // Bowling aggregated by (season, game_type)
      mockExecute.mockResolvedValueOnce([
        {
          season: 2024,
          game_type: "Standard",
          innings: "9",
          total_maidens: "15",
          total_runs_conceded: "280",
          total_wickets: "22",
          total_balls: "480",
          best_wickets: "5",
        },
      ]);

      // Best bowling per (season, game_type)
      mockExecute.mockResolvedValueOnce([
        {
          season: 2024,
          game_type: "Standard",
          wickets: "5",
          runs: "28",
        },
      ]);

      // All bowling rows (for per-format overall best — reduced in JS now).
      mockExecute.mockResolvedValueOnce([
        { game_type: "Standard", wickets: 5, runs: 28 },
        { game_type: "Standard", wickets: 3, runs: 40 },
      ]);

      const result = await getPlayerCareerStats(db)("entry-123");

      assert(result !== null);
      expect(result.playCricketId).toBe("pc-100");
      // Hardball-only player → exactly one format section, no empty card.
      expect(result.formats).toHaveLength(1);
      const hardball = result.formats[0];
      expect(hardball.gameType).toBe("Standard");
      expect(hardball.label).toBe("Hardball");
      expect(hardball.career.batting.runs).toBe(550);
      expect(hardball.career.batting.highScore).toBe(85);
      expect(hardball.career.batting.matches).toBe(18);
      expect(hardball.career.bowling.wickets).toBe(22);
      expect(hardball.battingSeasons).toHaveLength(2);
      expect(hardball.bowlingSeasons).toHaveLength(1);
      expect(hardball.bowlingSeasons[0].bestBowling).toBe("5/28");
    });
  });
});
