import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import type { PlayCricketApiClient } from "./api-client.ts";
import type { RvClient } from "./rv-client.ts";
import { ingestRvDataForMatch } from "./rv-ingest.ts";
import type {
  RvBall,
  RvMatchOverview as RvMatchOverviewT,
} from "./rv-schemas.ts";
import { getMatchDetail, getPlayerCareerStats, getTeams } from "./service.ts";
import { runSync } from "./sync.ts";

// Mock RV client for the ingest tests below — wired with the same
// curried-deps pattern as the real createRvClient. Each method returns
// either a plain value or a function that yields a value per call (so
// tests can stage different responses across multiple invocations).
function makeMockRv(overrides: {
  mapping?: { rvMatchId: string } | null;
  match?: RvMatchOverviewT | null;
  balls?: RvBall[][] | RvBall[];
}): RvClient & { calls: { mapping: number; match: number; balls: number } } {
  const calls = { mapping: 0, match: 0, balls: 0 };
  const ballsArray = Array.isArray(overrides.balls?.[0])
    ? (overrides.balls as RvBall[][])
    : overrides.balls
      ? [overrides.balls as RvBall[]]
      : [[]];
  return {
    calls,
    getMatchMapping: vi.fn(() => {
      calls.mapping++;
      return Promise.resolve(overrides.mapping ?? null);
    }),
    getMatch: vi.fn(() => {
      calls.match++;
      return Promise.resolve(overrides.match ?? null);
    }),
    getBalls: vi.fn(() => {
      const next = ballsArray[calls.balls] ?? [];
      calls.balls++;
      return Promise.resolve(next);
    }),
  };
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

describe("play-cricket service (integration)", () => {
  describe("getTeams", () => {
    it("returns teams from play_cricket_team table", async () => {
      const teamId = `pct-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("play_cricket_team")
        .values({
          id: teamId,
          name: "Test XI",
          site_id: "site-99",
        })
        .execute();

      const result = await getTeams(ctx.db)();
      const ids = result.teams.map((t) => t.id);
      expect(ids).toContain(teamId);
    });
  });

  describe("getMatchDetail", () => {
    it("returns cached data when cache is fresh", async () => {
      const matchId = `m-${crypto.randomUUID()}`;
      const cachedPayload = { runs: 200, wickets: 5, match_date: "2026-07-01" };

      await ctx.db
        .insertInto("play_cricket_match_cache")
        .values({
          match_id: matchId,
          data: JSON.stringify(cachedPayload),
          match_date: "2026-07-01",
          fetched_at: new Date().toISOString(), // fresh
        })
        .execute();

      const result = (await getMatchDetail(ctx.db)(matchId)) as Record<
        string,
        unknown
      >;
      expect(result).toEqual(cachedPayload);
    });

    it("returns stale cache entry as null-ish and fetches from API (external call)", async () => {
      const matchId = `stale-${crypto.randomUUID()}`;
      const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago

      await ctx.db
        .insertInto("play_cricket_match_cache")
        .values({
          match_id: matchId,
          data: JSON.stringify({ old: true }),
          match_date: "2026-07-01",
          fetched_at: staleTime,
        })
        .execute();

      // This will attempt to call the external API, which will fail in tests.
      // We verify that stale cache is not returned directly by checking it
      // tries to fetch (and throws since the API client isn't configured).
      await expect(getMatchDetail(ctx.db)(matchId)).rejects.toThrow();
    });
  });

  describe("getPlayerCareerStats", () => {
    it("returns null when no slug link exists", async () => {
      const result = await getPlayerCareerStats(ctx.db)(
        `nonexistent-${crypto.randomUUID()}`,
      );
      expect(result).toBeNull();
    });

    it("returns null when member has no play_cricket_id", async () => {
      const email = `nopc-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      // Set slug but no play_cricket_id
      const slug = `slug-${crypto.randomUUID()}`;
      await ctx.db
        .updateTable("member")
        .set({ slug, play_cricket_id: null })
        .where("id", "=", memberId ?? "")
        .execute();

      const result = await getPlayerCareerStats(ctx.db)(slug);
      expect(result).toBeNull();
    });

    it("aggregates batting and bowling stats correctly", async () => {
      const email = `career-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const slug = `slug-${crypto.randomUUID()}`;
      const playCricketId = `pc-${crypto.randomUUID()}`;

      await ctx.db
        .updateTable("member")
        .set({
          slug,
          play_cricket_id: playCricketId,
        })
        .where("id", "=", memberId ?? "")
        .execute();

      // Seed batting performances across two seasons
      await ctx.db
        .insertInto("match_performance_batting")
        .values([
          {
            id: crypto.randomUUID(),
            match_id: `m-${crypto.randomUUID()}`,
            match_date: "2025-06-01",
            season: 2025,
            team_id: "team-1",
            player_id: playCricketId,
            player_name: "Test Player",
            runs: 50,
            balls: 40,
            fours: 5,
            sixes: 1,
            how_out: "caught",
            not_out: false,
            competition_type: "league",
          },
          {
            id: crypto.randomUUID(),
            match_id: `m-${crypto.randomUUID()}`,
            match_date: "2026-06-15",
            season: 2026,
            team_id: "team-1",
            player_id: playCricketId,
            player_name: "Test Player",
            runs: 100,
            balls: 80,
            fours: 10,
            sixes: 3,
            how_out: "not out",
            not_out: true,
            competition_type: "league",
          },
        ])
        .execute();

      // Seed bowling performances
      await ctx.db
        .insertInto("match_performance_bowling")
        .values([
          {
            id: crypto.randomUUID(),
            match_id: `m-${crypto.randomUUID()}`,
            match_date: "2025-07-01",
            season: 2025,
            team_id: "team-1",
            player_id: playCricketId,
            player_name: "Test Player",
            overs: "8",
            maidens: 2,
            runs: 30,
            wickets: 3,
            wides: 1,
            no_balls: 0,
            competition_type: "league",
          },
        ])
        .execute();

      const result = await getPlayerCareerStats(ctx.db)(slug);
      expect(result).not.toBeNull();
      expect(result?.playCricketId).toBe(playCricketId);

      // Career batting totals
      expect(result?.career.batting.runs).toBe(150); // 50 + 100
      expect(result?.career.batting.matches).toBe(2);
      expect(result?.career.batting.highScore).toBe(100);
      expect(result?.career.batting.notOuts).toBe(1);

      // Career bowling totals
      expect(result?.career.bowling.wickets).toBe(3);
      expect(result?.career.bowling.innings).toBe(1);

      // Per-season batting breakdown
      expect(result?.battingSeasons).toHaveLength(2);
      expect(result?.bowlingSeasons).toHaveLength(1);

      // Seasons list
      expect(result?.seasons).toContain(2025);
      expect(result?.seasons).toContain(2026);
    });
  });
});

// --- Sync integration tests ---

function createMockApi(
  overrides: Partial<PlayCricketApiClient> = {},
): PlayCricketApiClient {
  return {
    getTeams: vi.fn().mockResolvedValue({ teams: [] }),
    getMatchesSummary: vi.fn().mockResolvedValue({ matches: [] }),
    getMatchDetail: vi.fn().mockResolvedValue({ match_details: [] }),
    getPlayers: vi.fn().mockResolvedValue({ players: [] }),
    getLeagueTable: vi.fn().mockResolvedValue({}),
    getMatchesForSite: vi.fn().mockResolvedValue({ matches: [] }),
    getResultSummaryForSite: vi.fn().mockResolvedValue({ result_summary: [] }),
    ...overrides,
  };
}

const SITE_ID = "134";
const OUR_TEAM_ID = "68498";
const OPPONENT_TEAM_ID = "99999";

function makeMatchSummary(id: number, matchDate = "01/07/2026") {
  return {
    id,
    status: "Completed",
    published: "Yes",
    last_updated: "2026-07-01",
    season: "2026",
    match_date: matchDate,
    home_club_name: "Percy Main",
    home_team_name: "1st XI",
    home_team_id: OUR_TEAM_ID,
    home_club_id: SITE_ID,
    away_club_name: "Opposition CC",
    away_team_name: "1st XI",
    away_team_id: OPPONENT_TEAM_ID,
    away_club_id: "999",
  };
}

function makeMatchDetail(matchId: number) {
  return {
    match_details: [
      {
        id: matchId,
        home_team_name: "Percy Main 1st XI",
        home_team_id: OUR_TEAM_ID,
        home_club_name: "Percy Main",
        home_club_id: SITE_ID,
        away_team_name: "Opposition 1st XI",
        away_team_id: OPPONENT_TEAM_ID,
        away_club_name: "Opposition CC",
        away_club_id: "999",
        result: "Won by 5 wickets",
        result_description: "Percy Main won",
        result_applied_to: OUR_TEAM_ID,
        players: [
          {
            home_team: [
              {
                position: 1,
                player_name: "A Batsman",
                player_id: 1001,
                captain: false,
                wicket_keeper: false,
              },
              {
                position: 7,
                player_name: "B Keeper",
                player_id: 1002,
                captain: false,
                wicket_keeper: true,
              },
            ],
            away_team: [
              {
                position: 1,
                player_name: "X Bowler",
                player_id: 2001,
                captain: false,
                wicket_keeper: false,
              },
            ],
          },
        ],
        innings: [
          {
            team_batting_name: "Opposition 1st XI",
            team_batting_id: OPPONENT_TEAM_ID,
            innings_number: 1,
            extra_byes: "0",
            extra_leg_byes: "2",
            extra_wides: "5",
            extra_no_balls: "1",
            extra_penalty_runs: "0",
            penalties_runs_awarded_in_other_innings: "0",
            total_extras: "8",
            runs: "150",
            wickets: "10",
            overs: "45",
            declared: false,
            revised_target_runs: "0",
            revised_target_overs: "0",
            bat: [
              {
                position: "1",
                batsman_name: "X Bowler",
                batsman_id: "2001",
                how_out: "ct",
                fielder_name: "B Keeper",
                fielder_id: "1002",
                bowler_name: "C Bowler",
                bowler_id: "1003",
                runs: "45",
                fours: "5",
                sixes: "1",
                balls: "60",
              },
              {
                position: "2",
                batsman_name: "Y Batsman",
                batsman_id: "2002",
                how_out: "ro",
                fielder_name: "A Batsman",
                fielder_id: "1001",
                runs: "30",
                fours: "3",
                sixes: "0",
                balls: "40",
              },
            ],
            bowl: [
              {
                bowler_name: "C Bowler",
                bowler_id: "1003",
                overs: "10",
                maidens: "2",
                runs: "35",
                wickets: "3",
                wides: "1",
                no_balls: "0",
              },
            ],
            fow: [],
          },
          {
            team_batting_name: "Percy Main 1st XI",
            team_batting_id: OUR_TEAM_ID,
            innings_number: 2,
            extra_byes: "1",
            extra_leg_byes: "0",
            extra_wides: "3",
            extra_no_balls: "0",
            extra_penalty_runs: "0",
            penalties_runs_awarded_in_other_innings: "0",
            total_extras: "4",
            runs: "155",
            wickets: "5",
            overs: "40",
            declared: false,
            revised_target_runs: "0",
            revised_target_overs: "0",
            bat: [
              {
                position: "1",
                batsman_name: "A Batsman",
                batsman_id: "1001",
                how_out: "caught",
                fielder_name: "X Bowler",
                fielder_id: "2001",
                bowler_name: "Z Bowler",
                bowler_id: "2003",
                runs: "85",
                fours: "10",
                sixes: "2",
                balls: "100",
              },
              {
                position: "2",
                batsman_name: "B Keeper",
                batsman_id: "1002",
                how_out: "no",
                runs: "60",
                fours: "7",
                sixes: "1",
                balls: "70",
              },
            ],
            bowl: [],
            fow: [],
          },
        ],
      },
    ],
  };
}

describe("play-cricket sync (integration)", () => {
  it("syncs teams from API", async () => {
    const api = createMockApi({
      getTeams: vi.fn().mockResolvedValue({
        teams: [
          {
            id: "68498",
            status: "Active",
            last_updated: "2026-01-01",
            site_id: "134",
            team_name: "1st XI",
          },
          {
            id: "71066",
            status: "Active",
            last_updated: "2026-01-01",
            site_id: "134",
            team_name: "Under 13s",
          },
        ],
      }),
    });

    const sync = runSync(ctx.db, api);
    await sync({ siteId: SITE_ID });

    const teams = await ctx.db
      .selectFrom("play_cricket_team")
      .where("site_id", "=", SITE_ID)
      .selectAll()
      .execute();

    const teamNames = teams.map((t) => t.name);
    expect(teamNames).toContain("1st XI");
    expect(teamNames).toContain("Under 13s");

    const juniorTeam = teams.find((t) => t.name === "Under 13s");
    expect(juniorTeam?.is_junior).toBe(true);

    const seniorTeam = teams.find((t) => t.name === "1st XI");
    expect(seniorTeam?.is_junior).toBe(false);
  });

  it("stores batting, bowling, and fielding performances", async () => {
    const matchId = 77700 + Math.floor(Math.random() * 1000);
    const api = createMockApi({
      getMatchesSummary: vi
        .fn()
        .mockResolvedValue({ matches: [makeMatchSummary(matchId)] }),
      getMatchDetail: vi.fn().mockResolvedValue(makeMatchDetail(matchId)),
    });

    const sync = runSync(ctx.db, api);
    const result = await sync({ siteId: SITE_ID });

    expect(result.matchesProcessed).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Check batting (our team batted in innings 2)
    const batting = await ctx.db
      .selectFrom("match_performance_batting")
      .where("match_id", "=", matchId.toString())
      .selectAll()
      .execute();

    expect(batting).toHaveLength(2);
    const aBatsman = batting.find((b) => b.player_id === "1001");
    assert(aBatsman, "Expected batting record for player 1001");
    expect(aBatsman.runs).toBe(85);
    expect(aBatsman.not_out).toBe(false);

    const bKeeper = batting.find((b) => b.player_id === "1002");
    assert(bKeeper, "Expected batting record for player 1002");
    expect(bKeeper.runs).toBe(60);
    expect(bKeeper.not_out).toBe(true);

    // Check bowling (our team bowled in innings 1)
    const bowling = await ctx.db
      .selectFrom("match_performance_bowling")
      .where("match_id", "=", matchId.toString())
      .selectAll()
      .execute();

    expect(bowling).toHaveLength(1);
    expect(bowling[0].player_id).toBe("1003");
    expect(bowling[0].wickets).toBe(3);
    expect(bowling[0].overs).toBe("10");

    // Check fielding (our team fielded in innings 1)
    const fielding = await ctx.db
      .selectFrom("match_performance_fielding")
      .where("match_id", "=", matchId.toString())
      .selectAll()
      .execute();

    expect(fielding).toHaveLength(2);

    const keeperFielding = fielding.find((f) => f.player_id === "1002");
    assert(keeperFielding, "Expected fielding record for player 1002");
    expect(keeperFielding.catches).toBe(1);
    expect(keeperFielding.is_wicketkeeper).toBe(true);

    const batsmanFielding = fielding.find((f) => f.player_id === "1001");
    assert(batsmanFielding, "Expected fielding record for player 1001");
    expect(batsmanFielding.run_outs).toBe(1);
    expect(batsmanFielding.is_wicketkeeper).toBe(false);
  });

  it("stores match result", async () => {
    const matchId = 88800 + Math.floor(Math.random() * 1000);
    const api = createMockApi({
      getMatchesSummary: vi
        .fn()
        .mockResolvedValue({ matches: [makeMatchSummary(matchId)] }),
      getMatchDetail: vi.fn().mockResolvedValue(makeMatchDetail(matchId)),
    });

    const sync = runSync(ctx.db, api);
    await sync({ siteId: SITE_ID });

    const result = await ctx.db
      .selectFrom("match_result")
      .where("match_id", "=", matchId.toString())
      .selectAll()
      .executeTakeFirst();

    assert(result, "Expected match result to be stored");
    expect(result.result).toBe("Won by 5 wickets");
    expect(result.home_team_id).toBe(OUR_TEAM_ID);
    expect(result.season).toBe(2026);
  });

  it("logs sync to play_cricket_sync_log", async () => {
    const api = createMockApi();

    const sync = runSync(ctx.db, api);
    await sync({ siteId: SITE_ID });

    const logs = await ctx.db
      .selectFrom("play_cricket_sync_log")
      .selectAll()
      .execute();

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const latest = logs[logs.length - 1];
    expect(latest.completed_at).not.toBeNull();
    expect(latest.season).toBe(new Date().getFullYear());
  });

  it("skips already-processed matches outside the resync window", async () => {
    const matchId = 55500 + Math.floor(Math.random() * 1000);
    // Dated well in the past so it falls outside the 7-day resync window.
    // The DB stores ISO; the API summary still emits dd/mm/yyyy.
    const oldDateIso = "2024-07-01";
    const oldDatePc = "01/07/2024";

    await ctx.db
      .insertInto("match_result")
      .values({
        id: crypto.randomUUID(),
        match_id: matchId.toString(),
        home_team_id: OUR_TEAM_ID,
        away_team_id: OPPONENT_TEAM_ID,
        home_team_name: "Percy Main 1st XI",
        away_team_name: "Opposition 1st XI",
        match_date: oldDateIso,
        season: 2024,
      })
      .execute();

    const api = createMockApi({
      getMatchesSummary: vi
        .fn()
        .mockResolvedValue({ matches: [makeMatchSummary(matchId, oldDatePc)] }),
    });

    const sync = runSync(ctx.db, api);
    const result = await sync({ siteId: SITE_ID });

    expect(result.matchesProcessed).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
    expect(api.getMatchDetail).not.toHaveBeenCalled();
  });

  it("continues when individual match fails", async () => {
    const goodMatchId = 66600 + Math.floor(Math.random() * 1000);
    const badMatchId = goodMatchId + 1;

    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({
        matches: [makeMatchSummary(badMatchId), makeMatchSummary(goodMatchId)],
      }),
      getMatchDetail: vi.fn().mockImplementation((matchId: string) => {
        if (matchId === badMatchId.toString()) {
          throw new Error("API timeout");
        }
        return makeMatchDetail(goodMatchId);
      }),
    });

    const sync = runSync(ctx.db, api);
    const result = await sync({ siteId: SITE_ID });

    expect(result.matchesProcessed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("API timeout");
  });

  it("does not store result for recent matches without a result", async () => {
    const matchId = 44400 + Math.floor(Math.random() * 1000);

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    const todayStr = `${dd}/${mm}/${yyyy}`;

    const matchSummary = makeMatchSummary(matchId, todayStr);
    const matchDetail = makeMatchDetail(matchId);
    matchDetail.match_details[0].result = "";

    const api = createMockApi({
      getMatchesSummary: vi.fn().mockResolvedValue({ matches: [matchSummary] }),
      getMatchDetail: vi.fn().mockResolvedValue(matchDetail),
    });

    const sync = runSync(ctx.db, api);
    await sync({ siteId: SITE_ID });

    const result = await ctx.db
      .selectFrom("match_result")
      .where("match_id", "=", matchId.toString())
      .selectAll()
      .executeTakeFirst();

    expect(result).toBeUndefined();
  });
});

// --- RV ingest integration ---

describe("ingestRvDataForMatch (integration)", () => {
  // The ingest writes match_ball / match_stream rows that FK to
  // match_result.match_id, so each test seeds a parent match_result row
  // first. We don't go through runSync — that's covered separately —
  // and stay focused on the RV side of the pipeline.
  async function seedMatchResult(matchId: string, matchDate = "2026-05-02") {
    await ctx.db
      .insertInto("match_result")
      .values({
        id: crypto.randomUUID(),
        match_id: matchId,
        home_team_id: "1",
        away_team_id: "2",
        home_team_name: "1st XI",
        away_team_name: "1st XI",
        match_date: matchDate,
        season: 2026,
      })
      .onConflict((oc) => oc.column("match_id").doNothing())
      .execute();
  }

  function makeOverview(
    overrides: Partial<RvMatchOverviewT> = {},
  ): RvMatchOverviewT {
    return {
      match_id: 7464451,
      external_match_id: 7262912,
      MatchTeams: [
        {
          team_name: "Backworth CC 2nd XI",
          result_id: 25398667,
          Innings: [{ innings_number: 1, PlayerPerfs: [] }],
        },
        {
          team_name: "Percy Main CC 1st XI",
          result_id: 25398668,
          Innings: [
            {
              innings_number: 1,
              PlayerPerfs: [
                {
                  player_id: 11680433,
                  external_id: "4386566",
                  player_name: "S Knight",
                },
                {
                  player_id: 12367961,
                  external_id: "5102931",
                  player_name: "K Pattison",
                },
              ],
            },
          ],
        },
      ],
      matchStreams: [
        {
          id: 71781,
          match_id: 7464451,
          video_id: "cu4A54DjCDI",
          frogbox_stream_id: "59e32fe6-7502-4433-9044-413838f2f20e",
          stream_provider_id: 3,
          start_utc: "/Date(1777718649000+0100)/",
          recording_started_utc: "/Date(1777718779000+0100)/",
          publish_status_id: 0,
          description: null,
        },
      ],
      ...overrides,
    };
  }

  function makeBall(
    over_no: number,
    ball_no: number,
    overrides: Partial<RvBall> = {},
  ): RvBall {
    // ball_time anchored ~20 minutes after recording_started for ball 1,
    // each subsequent ball nominally 30s later. Lets us assert that
    // ball_offset_seconds is computed from the recording anchor.
    const recordingMs = 1777718779000;
    return {
      innings_number: 1,
      over_no,
      ball_no,
      ball_no_disp: ball_no,
      result_id: 25398668,
      batter_id: 11680433,
      batter_id_ns: 12367961,
      bowler_id: 12367961,
      runs_bat: 0,
      runs_extra: 0,
      extras_type: null,
      l_desc: " K Pattison to S Knight: No run",
      s_desc: " .",
      ball_time: `/Date(${recordingMs + 1200_000 + ball_no * 30_000}+0100)/`,
      match_highlight_events: [],
      ...overrides,
    };
  }

  it("happy path: maps PC->RV, persists player mapping, stream, and balls (with offsets)", async () => {
    const matchId = `rv-happy-${crypto.randomUUID()}`;
    await seedMatchResult(matchId);

    const ball1 = makeBall(0, 1);
    const ball2 = makeBall(0, 2, {
      runs_bat: 4,
      l_desc: " K Pattison to S Knight: 4 runs",
      s_desc: " 4",
      match_highlight_events: [{ event_id: 1002, metric: 4 }],
    });
    const wicket = makeBall(0, 3, {
      runs_bat: 0,
      dismissed_batter_id: 11680433,
      l_desc: " K Pattison to S Knight: dismissed",
      s_desc: " W",
    });

    const rv = makeMockRv({
      mapping: { rvMatchId: "7464451" },
      match: makeOverview(),
      // First call is for result_id 25398667 inn 1 (Backworth) — empty.
      // Second call is for 25398668 inn 1 (Percy Main) — three balls.
      // The probe stops at the first empty innings per result_id, so
      // there should be exactly four getBalls calls total (1 empty for
      // Backworth, 1 with balls for PM, 1 empty for PM probing inn 2).
      balls: [[], [ball1, ball2, wicket], []],
    });

    const wrote = await ingestRvDataForMatch(ctx.db, rv, matchId, "2026-05-02");

    expect(wrote).toBe(true);

    const balls = await ctx.db
      .selectFrom("match_ball")
      .where("match_id", "=", matchId)
      .orderBy("ball_no")
      .selectAll()
      .execute();
    expect(balls).toHaveLength(3);
    expect(balls[0]?.s_desc).toBe(" .");
    expect(balls[1]?.runs_bat).toBe(4);
    expect(balls[1]?.highlight_events).toEqual([{ event_id: 1002, metric: 4 }]);
    expect(balls[2]?.dismissed_batter_rv_id).toBe(11680433);
    expect(balls[2]?.s_desc).toBe(" W");

    // ball_offset_seconds is rounded(ball_time - recording_started_utc).
    // Anchor is 1777718779000; ball1's ball_time is anchor + 1200s + 30s
    // = anchor + 1230s.
    expect(balls[0]?.ball_offset_seconds).toBe(1230);
    expect(balls[1]?.ball_offset_seconds).toBe(1260);
    expect(balls[2]?.ball_offset_seconds).toBe(1290);

    const streams = await ctx.db
      .selectFrom("match_stream")
      .where("match_id", "=", matchId)
      .selectAll()
      .execute();
    expect(streams).toHaveLength(1);
    expect(streams[0]?.video_id).toBe("cu4A54DjCDI");

    const mappings = await ctx.db
      .selectFrom("rv_player_mapping")
      .where("rv_player_id", "in", [11680433, 12367961])
      .selectAll()
      .execute();
    expect(mappings).toHaveLength(2);
    const knight = mappings.find((m) => m.rv_player_id === 11680433);
    expect(knight?.pc_player_id).toBe("4386566");
    expect(knight?.player_name).toBe("S Knight");
  });

  it("idempotent: re-running for the same match produces no duplicates and applies updates", async () => {
    const matchId = `rv-idem-${crypto.randomUUID()}`;
    await seedMatchResult(matchId);

    const initial = makeBall(0, 1, {
      runs_bat: 2,
      l_desc: " K Pattison to S Knight: 2 runs",
    });
    const corrected = makeBall(0, 1, {
      runs_bat: 4,
      l_desc: " K Pattison to S Knight: 4 runs (corrected)",
      s_desc: " 4",
    });

    const rvFirst = makeMockRv({
      mapping: { rvMatchId: "7464451" },
      match: makeOverview(),
      balls: [[], [initial], []],
    });
    await ingestRvDataForMatch(ctx.db, rvFirst, matchId, "2026-05-02");

    const rvSecond = makeMockRv({
      mapping: { rvMatchId: "7464451" },
      match: makeOverview(),
      balls: [[], [corrected], []],
    });
    await ingestRvDataForMatch(ctx.db, rvSecond, matchId, "2026-05-02");

    const balls = await ctx.db
      .selectFrom("match_ball")
      .where("match_id", "=", matchId)
      .selectAll()
      .execute();
    expect(balls).toHaveLength(1);
    expect(balls[0]?.runs_bat).toBe(4);
    expect(balls[0]?.l_desc).toContain("corrected");
  });

  it("skips silently when the mapping endpoint returns no mapping", async () => {
    const matchId = `rv-nomap-${crypto.randomUUID()}`;
    await seedMatchResult(matchId);

    const rv = makeMockRv({ mapping: null });
    const wrote = await ingestRvDataForMatch(ctx.db, rv, matchId, "2026-05-02");

    expect(wrote).toBe(false);
    expect(rv.calls.mapping).toBe(1);
    expect(rv.calls.match).toBe(0);
    expect(rv.calls.balls).toBe(0);
    const balls = await ctx.db
      .selectFrom("match_ball")
      .where("match_id", "=", matchId)
      .selectAll()
      .execute();
    expect(balls).toHaveLength(0);
  });

  it("skips silently when the overview returns null (404 / unknown match)", async () => {
    const matchId = `rv-no-overview-${crypto.randomUUID()}`;
    await seedMatchResult(matchId);

    const rv = makeMockRv({
      mapping: { rvMatchId: "7464451" },
      match: null,
    });
    const wrote = await ingestRvDataForMatch(ctx.db, rv, matchId, "2026-05-02");

    expect(wrote).toBe(false);
    expect(rv.calls.match).toBe(1);
    expect(rv.calls.balls).toBe(0);
  });

  it("skips silently when MatchTeams is empty", async () => {
    const matchId = `rv-empty-teams-${crypto.randomUUID()}`;
    await seedMatchResult(matchId);

    const rv = makeMockRv({
      mapping: { rvMatchId: "7464451" },
      match: makeOverview({ MatchTeams: [] }),
    });
    const wrote = await ingestRvDataForMatch(ctx.db, rv, matchId, "2026-05-02");

    expect(wrote).toBe(false);
    expect(rv.calls.balls).toBe(0);
  });

  it("leaves ball_offset_seconds null when no stream has a recording_started_utc", async () => {
    const matchId = `rv-no-anchor-${crypto.randomUUID()}`;
    await seedMatchResult(matchId);

    const overview = makeOverview({
      matchStreams: [], // no stream at all → no anchor
    });
    const rv = makeMockRv({
      mapping: { rvMatchId: "7464451" },
      match: overview,
      balls: [[], [makeBall(0, 1)], []],
    });

    await ingestRvDataForMatch(ctx.db, rv, matchId, "2026-05-02");

    const balls = await ctx.db
      .selectFrom("match_ball")
      .where("match_id", "=", matchId)
      .selectAll()
      .execute();
    expect(balls).toHaveLength(1);
    expect(balls[0]?.ball_offset_seconds).toBeNull();
  });

  it("persists canonical extras_type codes through to the DB", async () => {
    // Schema-level transform of RV's numeric/string codes is unit-tested
    // in rv-schemas.test.ts; this test asserts the canonical codes
    // travel through the upsert layer unchanged into the text column.
    const matchId = `rv-extras-${crypto.randomUUID()}`;
    await seedMatchResult(matchId);

    const nb = makeBall(0, 1, { runs_extra: 1, extras_type: "nb" });
    const wd = makeBall(0, 2, { runs_extra: 1, extras_type: "wd" });
    const b = makeBall(0, 3, { runs_extra: 1, extras_type: "b" });
    const lb = makeBall(0, 4, { runs_extra: 1, extras_type: "lb" });
    const none = makeBall(0, 5);

    const rv = makeMockRv({
      mapping: { rvMatchId: "7464451" },
      match: makeOverview(),
      balls: [[], [nb, wd, b, lb, none], []],
    });

    await ingestRvDataForMatch(ctx.db, rv, matchId, "2026-05-02");

    const balls = await ctx.db
      .selectFrom("match_ball")
      .where("match_id", "=", matchId)
      .orderBy("ball_no")
      .selectAll()
      .execute();
    expect(balls).toHaveLength(5);
    expect(balls.map((row) => row.extras_type)).toEqual([
      "nb",
      "wd",
      "b",
      "lb",
      null,
    ]);
  });
});
