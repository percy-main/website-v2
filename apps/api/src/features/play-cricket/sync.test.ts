import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackNotifier } from "../../lib/slack.ts";
import { createNoopLogger } from "../../lib/worker-logger.ts";

// Detection itself is covered in fantasy/service.test.ts; stubbing it here
// keeps these tests about the wiring - that the sync runs it, alerts on a
// hit, and shrugs off failures.
const { mockDetectPlayerIdChanges } = vi.hoisted(() => ({
  mockDetectPlayerIdChanges: vi.fn(),
}));

vi.mock("../fantasy/service.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../fantasy/service.ts")>()),
  detectPlayerIdChanges: () => mockDetectPlayerIdChanges,
}));

import type { PlayCricketApiClient } from "./api-client.ts";
import {
  didBat,
  hasScorecardEntry,
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

    it("returns true for not-out codes, both abbreviated and full text", () => {
      expect(isNotOut("no")).toBe(true);
      expect(isNotOut("not out")).toBe(true);
      expect(isNotOut("Not Out")).toBe(true);
      expect(isNotOut("rtd")).toBe(true);
      expect(isNotOut("retired hurt")).toBe(true);
      expect(isNotOut("retired not out")).toBe(true);
      expect(isNotOut("")).toBe(true);
    });

    it("returns false for dismissal codes, both abbreviated and full text", () => {
      expect(isNotOut("ct")).toBe(false);
      expect(isNotOut("caught")).toBe(false);
      expect(isNotOut("b")).toBe(false);
      expect(isNotOut("bowled")).toBe(false);
      expect(isNotOut("lbw")).toBe(false);
      expect(isNotOut("st")).toBe(false);
      expect(isNotOut("hit wicket")).toBe(false);
      expect(isNotOut("timed out")).toBe(false);
      expect(isNotOut("obstructing the field")).toBe(false);
    });

    it("returns false for run out and retired out - both are dismissals", () => {
      expect(isNotOut("ro")).toBe(false);
      expect(isNotOut("run out")).toBe(false);
      expect(isNotOut("retired out")).toBe(false);
      expect(isNotOut("ret out")).toBe(false);
    });
  });

  describe("didBat", () => {
    it("returns false when how_out says the player never batted", () => {
      expect(didBat({ how_out: "dnb" })).toBe(false);
      expect(didBat({ how_out: "did not bat" })).toBe(false);
      expect(didBat({ how_out: "Did Not Bat" })).toBe(false);
      expect(didBat({ how_out: "absent" })).toBe(false);
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

  describe("hasScorecardEntry", () => {
    it("returns true for explicit how_out, including did not bat", () => {
      expect(hasScorecardEntry({ how_out: "ct" })).toBe(true);
      expect(hasScorecardEntry({ how_out: "not out" })).toBe(true);
      // DNB rows are stored (as did_bat = false appearances)
      expect(hasScorecardEntry({ how_out: "did not bat" })).toBe(true);
      expect(hasScorecardEntry({ how_out: "absent" })).toBe(true);
    });

    it("returns false for placeholder rows with no how_out and no stats", () => {
      expect(hasScorecardEntry({ how_out: null })).toBe(false);
      expect(hasScorecardEntry({ how_out: "" })).toBe(false);
      expect(hasScorecardEntry({ how_out: "", runs: "0", balls: "0" })).toBe(
        false,
      );
    });

    it("returns true for softball batters (null how_out with stats)", () => {
      expect(hasScorecardEntry({ how_out: null, runs: "5", balls: "8" })).toBe(
        true,
      );
      expect(
        hasScorecardEntry({ how_out: null, runs: "0", times_out: "1" }),
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
    mockDetectPlayerIdChanges.mockResolvedValue([]);
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

  // --- Play Cricket ID-change alerting (#596) ---

  const suspectedChange = {
    oldPlayCricketId: "6324643",
    playerName: "Mashal Ahmed",
    eligible: true,
    pickCount: 2,
    candidates: [{ playCricketId: "7161990", playerName: "Mashal Ahmed" }],
  };

  it("runs ID-change detection against the current members list", async () => {
    mockApi = createMockApi({
      getPlayers: vi
        .fn()
        .mockResolvedValue({ players: [{ member_id: 111, name: "Alice" }] }),
    });

    const sync = runSync(mockDb, mockApi, null, log);
    await sync({ siteId: "134" });

    expect(mockApi.getPlayers).toHaveBeenCalled();
    expect(mockDetectPlayerIdChanges).toHaveBeenCalledWith([
      { member_id: 111, name: "Alice" },
    ]);
  });

  it("sends a Slack alert naming both IDs when a change is suspected", async () => {
    mockDetectPlayerIdChanges.mockResolvedValue([suspectedChange]);
    const notifySlack = vi.fn<SlackNotifier>().mockResolvedValue(true);

    const sync = runSync(mockDb, mockApi, null, log, notifySlack);
    const result = await sync({ siteId: "134" });

    expect(notifySlack).toHaveBeenCalledTimes(1);
    const text: string = notifySlack.mock.calls[0][0];
    expect(text).toContain("Mashal Ahmed");
    expect(text).toContain("6324643");
    expect(text).toContain("7161990");
    expect(result.errors).toHaveLength(0);
  });

  it("stays quiet when nothing is suspected", async () => {
    const notifySlack = vi.fn<SlackNotifier>().mockResolvedValue(true);

    const sync = runSync(mockDb, mockApi, null, log, notifySlack);
    await sync({ siteId: "134" });

    expect(notifySlack).not.toHaveBeenCalled();
  });

  it("completes the sync when Slack delivery fails", async () => {
    mockDetectPlayerIdChanges.mockResolvedValue([suspectedChange]);
    const notifySlack = vi
      .fn<SlackNotifier>()
      .mockRejectedValue(new Error("slack is down"));

    const sync = runSync(mockDb, mockApi, null, log, notifySlack);
    const result = await sync({ siteId: "134" });

    // Alerting is best-effort: nothing lands in errors, so the runner still
    // exits 0 and the data half of the sync is not reported as failed.
    expect(result.errors).toHaveLength(0);
  });

  it("completes the sync when detection itself fails", async () => {
    mockDetectPlayerIdChanges.mockRejectedValue(new Error("db is down"));
    const notifySlack = vi.fn<SlackNotifier>().mockResolvedValue(true);

    const sync = runSync(mockDb, mockApi, null, log, notifySlack);
    const result = await sync({ siteId: "134" });

    expect(result.errors).toHaveLength(0);
    expect(notifySlack).not.toHaveBeenCalled();
  });

  it("completes the sync when the members fetch fails", async () => {
    mockApi = createMockApi({
      getPlayers: vi.fn().mockRejectedValue(new Error("Unauthorized")),
    });
    const notifySlack = vi.fn<SlackNotifier>().mockResolvedValue(true);

    const sync = runSync(mockDb, mockApi, null, log, notifySlack);
    const result = await sync({ siteId: "134" });

    expect(result.errors).toHaveLength(0);
    expect(notifySlack).not.toHaveBeenCalled();
  });
});
