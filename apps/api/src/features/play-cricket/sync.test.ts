import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
import type { PlayCricketApiClient } from "./api-client.js";
import {
  isJuniorTeam,
  isNotOut,
  didBat,
  parseDismissalType,
  runSync,
} from "./sync.js";

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
    it("returns false for null/undefined/empty/dnb", () => {
      expect(didBat(null)).toBe(false);
      expect(didBat(undefined)).toBe(false);
      expect(didBat("")).toBe(false);
      expect(didBat("dnb")).toBe(false);
    });

    it("returns true for batting dismissals", () => {
      expect(didBat("caught")).toBe(true);
      expect(didBat("bowled")).toBe(true);
      expect(didBat("no")).toBe(true);
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

  function createMockApi(overrides: Partial<PlayCricketApiClient> = {}): PlayCricketApiClient {
    return {
      getTeams: vi.fn().mockResolvedValue({ teams: [] }),
      getMatchesSummary: vi.fn().mockResolvedValue({ matches: [] }),
      getMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
      getLeagueTable: vi.fn().mockResolvedValue({}),
      getMatchScorecard: vi.fn().mockResolvedValue({}),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockApi = createMockApi();
  });

  it("returns zero matches when no matches exist", async () => {
    const sync = runSync(mockDb, mockApi);
    const result = await sync({ siteId: "134" });

    expect(result.matchesProcessed).toBe(0);
    expect(result.errors).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(new Date().getFullYear());
  });

  it("syncs extra seasons", async () => {
    const sync = runSync(mockDb, mockApi);
    await sync({ siteId: "134", extraSeasons: [2024, 2025] });

    /* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mocks */
    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(2024);
    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(2025);
    expect(mockApi.getMatchesSummary).toHaveBeenCalledWith(new Date().getFullYear());
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it("skips already-processed matches", async () => {
    // Return a match from the API
    mockApi = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          {
            id: 12345,
            status: "Completed",
            published: "Yes",
            last_updated: "2026-07-01",
            season: "2026",
            match_date: "01/07/2026",
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

    const sync = runSync(mockDb, mockApi);
    const result = await sync({ siteId: "134" });

    expect(result.matchesProcessed).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
    expect(mockApi.getMatchDetail).not.toHaveBeenCalled();
  });

  it("records team sync errors without failing", async () => {
    mockApi = createMockApi({
      getTeams: vi.fn().mockRejectedValue(new Error("Unauthorized")),
    });

    const sync = runSync(mockDb, mockApi);
    const result = await sync({ siteId: "134" });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Teams sync skipped");
    expect(result.errors[0]).toContain("Unauthorized");
  });

  it("logs sync result to play_cricket_sync_log", async () => {
    const sync = runSync(mockDb, mockApi);
    await sync({ siteId: "134" });

    // Should have called insertInto for the sync log
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
    expect(mockDb.insertInto).toHaveBeenCalledWith("play_cricket_sync_log");
  });
});
