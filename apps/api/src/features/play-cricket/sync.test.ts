import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import type { PlayCricketApiClient } from "./api-client.ts";
import {
  didBat,
  isJuniorTeam,
  isNotOut,
  parseDismissalType,
  runSync,
} from "./sync.ts";

const log = createNoopLogger();

// --- Helper tests ---

describe("sync helpers", () => {
  describe("isJuniorTeam", () => {
    it("detects 'under' in team name", () => {
      expect(isJuniorTeam("Under 11s")).toBe(true);
    });

    it("detects U followed by digits", () => {
      expect(isJuniorTeam("U13")).toBe(true);
      expect(isJuniorTeam("Percy Main U15")).toBe(true);
    });

    it("detects 'junior' and 'colts'", () => {
      expect(isJuniorTeam("Junior XI")).toBe(true);
      expect(isJuniorTeam("Colts")).toBe(true);
    });

    it("returns false for senior teams", () => {
      expect(isJuniorTeam("1st XI")).toBe(false);
      expect(isJuniorTeam("2nd XI")).toBe(false);
    });
  });

  describe("isNotOut", () => {
    it("returns true for null/undefined", () => {
      expect(isNotOut(null)).toBe(true);
      expect(isNotOut(undefined)).toBe(true);
    });

    it("returns true for not-out codes", () => {
      expect(isNotOut("no")).toBe(true);
      expect(isNotOut("dnb")).toBe(true);
      expect(isNotOut("rtd")).toBe(true);
      expect(isNotOut("")).toBe(true);
    });

    it("returns false for dismissal codes", () => {
      expect(isNotOut("caught")).toBe(false);
      expect(isNotOut("bowled")).toBe(false);
      expect(isNotOut("lbw")).toBe(false);
    });

    // run out is considered "not out" for batting average purposes
    it("returns true for run out", () => {
      expect(isNotOut("ro")).toBe(true);
    });
  });

  describe("didBat", () => {
    it("returns false when how_out is dnb regardless of stats", () => {
      expect(didBat({ how_out: "dnb" })).toBe(false);
      // Even if Play Cricket sends quantitative fields for a DNB row, "dnb"
      // is the explicit signal that they didn't take strike.
      expect(didBat({ how_out: "dnb", runs: "5", balls: "10" })).toBe(false);
    });

    it("returns false for null/empty how_out with no runs / balls / times_out", () => {
      expect(didBat({ how_out: null })).toBe(false);
      expect(didBat({ how_out: undefined })).toBe(false);
      expect(didBat({ how_out: "" })).toBe(false);
      expect(didBat({ how_out: "", runs: "", balls: "", times_out: "" })).toBe(
        false,
      );
      expect(
        didBat({ how_out: "", runs: "0", balls: "0", times_out: "0" }),
      ).toBe(false);
    });

    it("returns true for hardball dismissals", () => {
      expect(didBat({ how_out: "caught" })).toBe(true);
      expect(didBat({ how_out: "bowled" })).toBe(true);
      expect(didBat({ how_out: "no" })).toBe(true);
    });

    it("returns true for softball batters (null how_out with runs/balls)", () => {
      // Women's Softball: every batter has how_out=null; runs/balls/times_out
      // tell us they actually batted.
      expect(
        didBat({ how_out: null, runs: "5", balls: "8", times_out: "0" }),
      ).toBe(true);
      expect(
        didBat({ how_out: null, runs: "0", balls: "11", times_out: "1" }),
      ).toBe(true);
      expect(
        didBat({ how_out: null, runs: "0", balls: "0", times_out: "1" }),
      ).toBe(true);
    });
  });

  describe("parseDismissalType", () => {
    it("returns null for null/undefined", () => {
      expect(parseDismissalType(null)).toBeNull();
      expect(parseDismissalType(undefined)).toBeNull();
    });

    it("parses catches", () => {
      expect(parseDismissalType("ct")).toBe("catch");
      expect(parseDismissalType("caught Smith")).toBe("catch");
    });

    it("parses stumpings", () => {
      expect(parseDismissalType("st")).toBe("stumping");
      expect(parseDismissalType("stumped Jones")).toBe("stumping");
    });

    it("parses run outs", () => {
      expect(parseDismissalType("ro")).toBe("run_out");
      expect(parseDismissalType("run out")).toBe("run_out");
    });

    it("returns null for bowled/lbw", () => {
      expect(parseDismissalType("bowled")).toBeNull();
      expect(parseDismissalType("lbw")).toBeNull();
    });
  });
});

// --- Sync service tests ---

describe("runSync", () => {
  let mockDb: Kysely<DB>;
  let mockApi: PlayCricketApiClient;
  let mockInsertExecute: ReturnType<typeof vi.fn>;
  let mockSelectExecute: ReturnType<typeof vi.fn>;

  function createMockDb() {
    mockInsertExecute = vi.fn().mockResolvedValue([]);
    mockSelectExecute = vi.fn().mockResolvedValue([]);

    const chainable = {
      selectFrom: vi.fn().mockReturnThis(),
      insertInto: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      distinct: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockImplementation((cb: (oc: unknown) => unknown) => {
        const ocBuilder = {
          column: vi.fn().mockReturnValue({
            doUpdateSet: vi.fn().mockReturnValue({
              execute: mockInsertExecute,
            }),
          }),
          columns: vi.fn().mockReturnValue({
            doUpdateSet: vi.fn().mockReturnValue({
              execute: mockInsertExecute,
            }),
          }),
        };
        cb(ocBuilder);
        return { execute: mockInsertExecute };
      }),
      execute: mockSelectExecute,
      executeTakeFirst: vi.fn().mockResolvedValue(undefined),
    };

    return chainable as unknown as Kysely<DB>;
  }

  function createMockApi(
    overrides: Partial<PlayCricketApiClient> = {},
  ): PlayCricketApiClient {
    return {
      getTeams: vi.fn().mockResolvedValue({ teams: [] }),
      getMatchesSummary: vi.fn().mockResolvedValue({ matches: [] }),
      getMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
      getPlayers: vi.fn().mockResolvedValue({ players: [] }),
      getLeagueTable: vi.fn().mockResolvedValue({}),
      getLiveMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
      getMatchesForSite: vi.fn().mockResolvedValue({ matches: [] }),
      getResultSummaryForSite: vi
        .fn()
        .mockResolvedValue({ result_summary: [] }),
      getResultSummary: vi.fn().mockResolvedValue({ result_summary: [] }),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockApi = createMockApi();
  });

  it("returns zero matches when no matches exist", async () => {
    const sync = runSync(mockDb, mockApi, null, log);
    const result = await sync({ siteId: "134" });

    expect(result.matchesProcessed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(
      new Date().getFullYear(),
    );
  });

  it("syncs extra seasons", async () => {
    const sync = runSync(mockDb, mockApi, null, log);
    await sync({ siteId: "134", extraSeasons: [2024, 2025] });

    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(2024);
    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(2025);
    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(
      new Date().getFullYear(),
    );
  });

  it("skips already-processed matches outside the resync window", async () => {
    // Match dated well in the past so it's outside the resync window
    mockApi = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          {
            id: 12345,
            status: "Completed",
            published: "Yes",
            last_updated: "2024-07-01",
            season: "2024",
            match_date: "01/07/2024",
            home_club_name: "Percy Main",
            home_team_name: "1st XI",
            home_team_id: "68498",
            home_club_id: "134",
            away_club_name: "Opposition",
            away_team_name: "1st XI",
            away_team_id: "99999",
            away_club_id: "999",
          },
        ],
      }),
    });
    // Mark it as already processed
    mockSelectExecute.mockResolvedValueOnce([{ match_id: "12345" }]);

    const sync = runSync(mockDb, mockApi, null, log);
    const result = await sync({ siteId: "134" });

    expect(result.matchesProcessed).toBe(0);
    expect(mockApi.getMatchDetail).not.toHaveBeenCalled();
  });

  it("re-fetches already-processed matches inside the resync window", async () => {
    // Match dated yesterday — well inside the 7-day resync window.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dd = String(yesterday.getDate()).padStart(2, "0");
    const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
    const yyyy = yesterday.getFullYear();
    const matchDateStr = `${dd}/${mm}/${yyyy}`;

    mockApi = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          {
            id: 12345,
            status: "Completed",
            published: "Yes",
            last_updated: `${yyyy}-${mm}-${dd}`,
            season: String(yyyy),
            match_date: matchDateStr,
            home_club_name: "Percy Main",
            home_team_name: "1st XI",
            home_team_id: "68498",
            home_club_id: "134",
            away_club_name: "Opposition",
            away_team_name: "1st XI",
            away_team_id: "99999",
            away_club_id: "999",
          },
        ],
      }),
      // Detail with no scorecard — bails before any DB writes, but still
      // proves we did re-fetch despite the match already being processed.
      getMatchDetail: vi.fn().mockResolvedValue({
        match_details: [
          {
            home_team_id: "68498",
            home_team_name: "1st XI",
            home_club_id: "134",
            away_team_id: "99999",
            away_team_name: "1st XI",
            away_club_id: "999",
            innings: [],
            players: [],
            result: "",
            result_description: "",
            result_applied_to: "",
          },
        ],
      }),
    });
    // Mark it as already processed
    mockSelectExecute.mockResolvedValueOnce([{ match_id: "12345" }]);

    const sync = runSync(mockDb, mockApi, null, log);
    await sync({ siteId: "134" });

    expect(mockApi.getMatchDetail).toHaveBeenCalledWith("12345");
  });

  it("records team sync errors without failing", async () => {
    mockApi = createMockApi({
      getTeams: vi.fn().mockRejectedValue(new Error("Unauthorized")),
    });

    const sync = runSync(mockDb, mockApi, null, log);
    const result = await sync({ siteId: "134" });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Teams sync skipped");
    expect(result.errors[0]).toContain("Unauthorized");
  });

  it("logs sync result to play_cricket_sync_log", async () => {
    const sync = runSync(mockDb, mockApi, null, log);
    await sync({ siteId: "134" });

    // Should have called insertInto for the sync log
    expect(mockDb.insertInto).toHaveBeenCalledWith("play_cricket_sync_log");
  });
});
