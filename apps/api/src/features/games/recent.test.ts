import { describe, expect, it, vi } from "vitest";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import {
  buildResultNote,
  listRecentGames,
  londonNow,
  parseTimeToMinutes,
  type RecentGameInnings,
} from "./recent.ts";

const SITE_ID = "134";

// The module-level match-summary cache in service.ts is keyed by season
// with a 30-minute TTL, so every listRecentGames test pins its own year
// to keep Play Cricket fixtures isolated within this run.

function summaryMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 7000001,
    status: "New",
    published: "Yes",
    last_updated: "01/07/2030",
    season: "2030",
    match_date: "01/07/2030",
    match_time: "13:00",
    league_name: "NTCL",
    league_id: "15363",
    competition_name: "Division 4 North",
    competition_id: "135699",
    competition_type: "League",
    game_type: "Standard",
    ground_name: "St Johns Terrace",
    home_club_name: "Percy Main CC",
    home_team_name: "1st XI",
    home_team_id: "68498",
    home_club_id: SITE_ID,
    away_club_name: "Mitford CC",
    away_team_name: "1st XI",
    away_team_id: "80273",
    away_club_id: "4385",
    ...overrides,
  };
}

function resultRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7000001,
    status: "New",
    published: "Yes",
    last_updated: "02/07/2030",
    league_name: "NTCL",
    league_id: "15363",
    competition_name: "Division 4 North",
    competition_id: "135699",
    competition_type: "League",
    match_type: "Limited Overs",
    game_type: "Standard",
    match_date: "01/07/2030",
    match_time: "13:00",
    home_team_name: "1st XI",
    home_team_id: "68498",
    home_club_name: "Percy Main CC",
    home_club_id: SITE_ID,
    away_team_name: "1st XI",
    away_team_id: "80273",
    away_club_name: "Mitford CC",
    away_club_id: "4385",
    batted_first: "68498",
    result: "W",
    result_description: "Percy Main CC - 1st XI - Won",
    result_applied_to: "68498",
    innings: [
      {
        team_batting_id: "68498",
        innings_number: 1,
        runs: "220",
        wickets: "6",
        overs: "45.0",
        declared: false,
        forfeited_innings: false,
      },
      {
        team_batting_id: "80273",
        innings_number: 1,
        runs: "180",
        wickets: "10",
        overs: "41.3",
        declared: false,
        forfeited_innings: false,
      },
    ],
    ...overrides,
  };
}

function liveDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 7000001,
    home_team_name: "1st XI",
    home_team_id: "68498",
    home_club_name: "Percy Main CC",
    home_club_id: SITE_ID,
    away_team_name: "1st XI",
    away_team_id: "80273",
    away_club_name: "Mitford CC",
    away_club_id: "4385",
    result: "",
    result_description: "",
    result_applied_to: "",
    game_type: "Standard",
    match_type: "Limited Overs",
    innings: [],
    ...overrides,
  };
}

function createMockApi(
  overrides: Partial<PlayCricketApiClient> = {},
): PlayCricketApiClient {
  return {
    getTeams: vi.fn().mockResolvedValue({ teams: [] }),
    getMatchesSummary: vi.fn().mockResolvedValue({ matches: [] }),
    getMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
    getLiveMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
    getPlayers: vi.fn().mockResolvedValue({ players: [] }),
    getLeagueTable: vi.fn().mockResolvedValue({}),
    getMatchesForSite: vi.fn().mockResolvedValue({ matches: [] }),
    getResultSummaryForSite: vi.fn().mockResolvedValue({ result_summary: [] }),
    getResultSummary: vi.fn().mockResolvedValue({ result_summary: [] }),
    ...overrides,
  };
}

const log = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as never;

describe("londonNow", () => {
  it("reports London wall-clock during BST", () => {
    const t = londonNow(new Date("2030-07-06T13:30:00Z"));
    expect(t).toEqual({
      datePc: "06/07/2030",
      minutes: 14 * 60 + 30,
      year: 2030,
    });
  });

  it("reports London wall-clock during GMT", () => {
    const t = londonNow(new Date("2030-01-06T13:30:00Z"));
    expect(t).toEqual({
      datePc: "06/01/2030",
      minutes: 13 * 60 + 30,
      year: 2030,
    });
  });
});

describe("parseTimeToMinutes", () => {
  it("parses HH:mm", () => {
    expect(parseTimeToMinutes("13:00")).toBe(780);
    expect(parseTimeToMinutes("9:30")).toBe(570);
  });
  it("rejects junk", () => {
    expect(parseTimeToMinutes("")).toBeNull();
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes("1pm")).toBeNull();
  });
});

describe("buildResultNote", () => {
  const inn = (
    teamBattingId: string,
    runs: number,
    wickets: number,
  ): RecentGameInnings => ({
    teamBattingId,
    teamName: "T" + teamBattingId,
    runs,
    wickets,
    overs: "40.0",
    declared: false,
    allOut: wickets >= 10,
  });

  it("winner batting second: wickets margin", () => {
    expect(
      buildResultNote(
        "W",
        "Standard",
        [inn("A", 143, 10), inn("B", 144, 5)],
        "B",
      ),
    ).toBe("Won by 5 wickets");
  });

  it("singular wicket", () => {
    expect(
      buildResultNote(
        "L",
        "Standard",
        [inn("A", 185, 10), inn("B", 188, 9)],
        "B",
      ),
    ).toBe("Lost by 1 wicket");
  });

  it("winner batting first: runs margin", () => {
    expect(
      buildResultNote(
        "W",
        "Standard",
        [inn("A", 220, 6), inn("B", 180, 10)],
        "A",
      ),
    ).toBe("Won by 40 runs");
  });

  it("fixed outcomes", () => {
    expect(buildResultNote("A", "Standard", [], "")).toBe("Abandoned");
    expect(buildResultNote("C", "Standard", [], "")).toBe("Cancelled");
    expect(buildResultNote("N", "Standard", [], "")).toBe("No result");
    expect(buildResultNote("D", "Standard", [], "")).toBe("Match drawn");
    expect(buildResultNote("T", "Standard", [], "")).toBe("Match tied");
  });

  it("no margin for Pairs, odd innings counts, or unknown winner", () => {
    expect(
      buildResultNote("W", "Pairs", [inn("A", 64, 2), inn("B", 60, 3)], "A"),
    ).toBeNull();
    expect(buildResultNote("W", "Standard", [inn("A", 64, 2)], "A")).toBeNull();
    expect(
      buildResultNote("W", "Standard", [inn("A", 64, 2), inn("B", 60, 3)], ""),
    ).toBeNull();
  });
});

describe("listRecentGames", () => {
  it("returns the most recent results, newest first", async () => {
    // Quiet Wednesday, no games today.
    const now = new Date("2030-07-10T10:00:00Z");
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({ matches: [] }),
      getResultSummary: vi.fn().mockResolvedValue({
        result_summary: [
          resultRow({ id: 1, match_date: "28/06/2030" }),
          resultRow({
            id: 2,
            match_date: "06/07/2030",
            match_time: "18:00",
            result_applied_to: "80273",
            result_description: "Mitford CC - 1st XI - Won",
            innings: [
              {
                team_batting_id: "68498",
                runs: "185",
                wickets: "10",
                overs: "39.4",
                declared: false,
              },
              {
                team_batting_id: "80273",
                runs: "188",
                wickets: "9",
                overs: "41.5",
                declared: false,
              },
            ],
          }),
          resultRow({ id: 3, match_date: "05/07/2030" }),
          resultRow({ id: 4, match_date: "21/06/2030" }),
        ],
      }),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);

    expect(result.hasLive).toBe(false);
    expect(result.items.map((i) => i.id)).toEqual(["2", "3", "1"]);

    const [latest] = result.items;
    expect(latest.status).toBe("result");
    expect(latest.outcome).toBe("L");
    expect(latest.note).toBe("Lost by 1 wicket");
    expect(latest.home).toBe(true);
    expect(latest.opposition.club.name).toBe("Mitford CC");
    expect(latest.innings).toEqual([
      {
        teamBattingId: "68498",
        teamName: "Percy Main CC",
        runs: 185,
        wickets: 10,
        overs: "39.4",
        declared: false,
        allOut: true,
      },
      {
        teamBattingId: "80273",
        teamName: "Mitford CC",
        runs: 188,
        wickets: 9,
        overs: "41.5",
        declared: false,
        allOut: false,
      },
    ]);
  });

  it("maps outcome from the away side's perspective", async () => {
    const now = new Date("2031-07-10T10:00:00Z");
    const api = createMockApi({
      getResultSummary: vi.fn().mockResolvedValue({
        result_summary: [
          resultRow({
            id: 9,
            match_date: "05/07/2031",
            home_club_id: "4385",
            home_club_name: "Mitford CC",
            away_club_id: SITE_ID,
            away_club_name: "Percy Main CC",
            // Percy Main (away, team 80273 slot) won.
            home_team_id: "80273",
            away_team_id: "68498",
            batted_first: "80273",
            result_applied_to: "68498",
            innings: [
              {
                team_batting_id: "80273",
                runs: "143",
                wickets: "10",
                overs: "38.1",
                declared: false,
              },
              {
                team_batting_id: "68498",
                runs: "144",
                wickets: "5",
                overs: "31.2",
                declared: false,
              },
            ],
          }),
        ],
      }),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);
    const [item] = result.items;
    expect(item.home).toBe(false);
    expect(item.outcome).toBe("W");
    expect(item.note).toBe("Won by 5 wickets");
    expect(item.opposition.club.name).toBe("Mitford CC");
  });

  it("surfaces a started same-day game as live, ahead of results", async () => {
    // Sat 06/07/2032 15:00 London (14:00Z), game started 13:00.
    const now = new Date("2032-07-03T14:00:00Z");
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          summaryMatch({
            id: 42,
            season: "2032",
            match_date: "03/07/2032",
            match_time: "13:00",
          }),
        ],
      }),
      getResultSummary: vi.fn().mockResolvedValue({
        result_summary: [resultRow({ id: 1, match_date: "28/06/2032" })],
      }),
      getLiveMatchDetail: vi.fn().mockResolvedValue({
        match_details: [
          liveDetail({
            id: 42,
            innings: [
              {
                team_batting_id: "68498",
                runs: "185",
                wickets: "10",
                overs: "39.4",
                declared: false,
              },
              {
                team_batting_id: "80273",
                runs: "112",
                wickets: "4",
                overs: "28.0",
                declared: false,
              },
            ],
          }),
        ],
      }),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);

    expect(result.hasLive).toBe(true);
    expect(result.items[0]).toMatchObject({
      id: "42",
      status: "live",
      outcome: null,
      note: "Mitford CC need 74 more to win",
    });
    expect(result.items[0].innings).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ id: "1", status: "result" });
  });

  it("labels a live first innings and a scoreless in-play game", async () => {
    const now = new Date("2033-07-02T14:00:00Z");
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          summaryMatch({
            id: 50,
            season: "2033",
            match_date: "02/07/2033",
            match_time: "13:00",
          }),
          summaryMatch({
            id: 51,
            season: "2033",
            match_date: "02/07/2033",
            match_time: "13:30",
            home_team_name: "2nd XI",
            home_team_id: "68499",
            away_team_name: "2nd XI",
            away_team_id: "80274",
          }),
        ],
      }),
      getLiveMatchDetail: vi.fn().mockImplementation((matchId: string) =>
        Promise.resolve(
          matchId === "50"
            ? {
                match_details: [
                  liveDetail({
                    id: 50,
                    innings: [
                      {
                        team_batting_id: "68498",
                        runs: "64",
                        wickets: "2",
                        overs: "7.3",
                        declared: false,
                      },
                    ],
                  }),
                ],
              }
            : { match_details: [liveDetail({ id: 51 })] },
        ),
      ),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);

    expect(result.hasLive).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: "50",
      status: "live",
      note: "First innings in progress",
    });
    expect(result.items[1]).toMatchObject({
      id: "51",
      status: "live",
      note: "In play",
      innings: [],
    });
  });

  it("drops a scoreless game once the in-play window has passed", async () => {
    // 22:10 London; the 10:00 junior game never posted a score.
    const now = new Date("2034-07-01T21:10:00Z");
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          summaryMatch({
            id: 60,
            season: "2034",
            match_date: "01/07/2034",
            match_time: "10:00",
          }),
        ],
      }),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);
    expect(result.items).toEqual([]);
    expect(result.hasLive).toBe(false);
  });

  it("does not mark a game live before its start time", async () => {
    const now = new Date("2035-07-07T10:00:00Z"); // 11:00 London
    const getLiveMatchDetail = vi.fn().mockResolvedValue({ match_details: [] });
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          summaryMatch({
            id: 70,
            season: "2035",
            match_date: "07/07/2035",
            match_time: "13:00",
          }),
        ],
      }),
      getLiveMatchDetail,
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);
    expect(result.items).toEqual([]);
    expect(result.hasLive).toBe(false);
    expect(getLiveMatchDetail).not.toHaveBeenCalled();
  });

  it("promotes a just-finished game to a result before result_summary catches up", async () => {
    const now = new Date("2036-07-05T17:00:00Z");
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          summaryMatch({
            id: 80,
            season: "2036",
            match_date: "05/07/2036",
            match_time: "13:00",
          }),
        ],
      }),
      getResultSummary: vi.fn().mockResolvedValue({
        result_summary: [resultRow({ id: 2, match_date: "28/06/2036" })],
      }),
      getLiveMatchDetail: vi.fn().mockResolvedValue({
        match_details: [
          liveDetail({
            id: 80,
            result: "W",
            result_description: "Percy Main CC - 1st XI - Won",
            result_applied_to: "68498",
            innings: [
              {
                team_batting_id: "80273",
                runs: "143",
                wickets: "10",
                overs: "38.1",
                declared: false,
              },
              {
                team_batting_id: "68498",
                runs: "144",
                wickets: "5",
                overs: "31.2",
                declared: false,
              },
            ],
          }),
        ],
      }),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);

    expect(result.hasLive).toBe(false);
    expect(result.items[0]).toMatchObject({
      id: "80",
      status: "result",
      outcome: "W",
      note: "Won by 5 wickets",
    });
    expect(result.items[1]).toMatchObject({ id: "2" });
  });

  it("degrades to live-without-score when the detail call fails", async () => {
    const now = new Date("2037-07-04T14:00:00Z");
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [
          summaryMatch({
            id: 90,
            season: "2037",
            match_date: "04/07/2037",
            match_time: "13:00",
          }),
        ],
      }),
      getLiveMatchDetail: vi.fn().mockRejectedValue(new Error("pc down")),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);
    expect(result.hasLive).toBe(true);
    expect(result.items[0]).toMatchObject({
      id: "90",
      status: "live",
      note: "In play",
      innings: [],
    });
  });

  it("returns [] instead of failing when Play Cricket is down entirely", async () => {
    const now = new Date("2038-07-04T14:00:00Z");
    const api = createMockApi({
      getMatchesSummary: vi.fn().mockRejectedValue(new Error("pc down")),
      getResultSummary: vi.fn().mockRejectedValue(new Error("pc down")),
    });

    const result = await listRecentGames(api, SITE_ID)(log, now);
    expect(result).toEqual({ items: [], hasLive: false });
  });

  it("caches result_summary between calls", async () => {
    const now = new Date("2039-07-08T10:00:00Z");
    const getResultSummary = vi.fn().mockResolvedValue({
      result_summary: [resultRow({ id: 5, match_date: "05/07/2039" })],
    });
    const api = createMockApi({ getResultSummary });

    const recent = listRecentGames(api, SITE_ID);
    await recent(log, now);
    await recent(log, now);

    expect(getResultSummary).toHaveBeenCalledTimes(1);
  });
});
