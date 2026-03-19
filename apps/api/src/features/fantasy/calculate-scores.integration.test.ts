import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  calculateFantasyScores,
  calculateSlotEffectivePoints,
} from "./calculate-scores.ts";
import { SCORING } from "./scoring.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const SEASON = "2026";
const SEASON_NUM = 2026;
const TEAM_ID = "68498"; // 1st XI (eligible)
const OPPONENT_TEAM_ID = "99999";
const MATCH_DATE = "2026-05-02"; // After GW1 (2026-04-18), should be GW3

async function seedMatch(matchId: string, winnerTeamId: string = TEAM_ID) {
  await ctx.db
    .insertInto("match_result")
    .values({
      id: crypto.randomUUID(),
      match_id: matchId,
      match_date: MATCH_DATE,
      season: SEASON_NUM,
      home_team_id: TEAM_ID,
      home_team_name: "1st XI",
      away_team_id: OPPONENT_TEAM_ID,
      away_team_name: "Opponent",
      result_applied_to: winnerTeamId,
      result: "Won",
      result_description: "Won by 5 wickets",
      competition_type: "League",
    })
    .execute();
}

async function seedBatting(
  matchId: string,
  playerId: string,
  opts: {
    runs?: number;
    balls?: number;
    fours?: number;
    sixes?: number;
    notOut?: boolean;
  } = {},
) {
  await ctx.db
    .insertInto("match_performance_batting")
    .values({
      id: crypto.randomUUID(),
      match_id: matchId,
      match_date: MATCH_DATE,
      season: SEASON_NUM,
      team_id: TEAM_ID,
      player_id: playerId,
      player_name: `Player ${playerId}`,
      runs: opts.runs ?? 50,
      balls: opts.balls ?? 40,
      fours: opts.fours ?? 5,
      sixes: opts.sixes ?? 2,
      how_out: opts.notOut ? "not out" : "caught",
      not_out: opts.notOut ?? false,
      competition_type: "League",
    })
    .execute();
}

async function seedBowling(
  matchId: string,
  playerId: string,
  opts: {
    overs?: string;
    maidens?: number;
    runs?: number;
    wickets?: number;
  } = {},
) {
  await ctx.db
    .insertInto("match_performance_bowling")
    .values({
      id: crypto.randomUUID(),
      match_id: matchId,
      match_date: MATCH_DATE,
      season: SEASON_NUM,
      team_id: TEAM_ID,
      player_id: playerId,
      player_name: `Player ${playerId}`,
      overs: opts.overs ?? "8",
      maidens: opts.maidens ?? 1,
      runs: opts.runs ?? 30,
      wickets: opts.wickets ?? 3,
      competition_type: "League",
    })
    .execute();
}

async function seedFielding(
  matchId: string,
  playerId: string,
  opts: {
    catches?: number;
    runOuts?: number;
    stumpings?: number;
    isWicketkeeper?: boolean;
  } = {},
) {
  await ctx.db
    .insertInto("match_performance_fielding")
    .values({
      id: crypto.randomUUID(),
      match_id: matchId,
      match_date: MATCH_DATE,
      season: SEASON_NUM,
      team_id: TEAM_ID,
      player_id: playerId,
      player_name: `Player ${playerId}`,
      catches: opts.catches ?? 1,
      run_outs: opts.runOuts ?? 0,
      stumpings: opts.stumpings ?? 0,
      is_wicketkeeper: opts.isWicketkeeper ?? false,
      competition_type: "League",
    })
    .execute();
}

async function seedFantasyPlayer(playerId: string, sandwichCost = 1) {
  await ctx.db
    .insertInto("fantasy_player")
    .values({
      play_cricket_id: playerId,
      player_name: `Player ${playerId}`,
      eligible: true,
      sandwich_cost: sandwichCost,
    })
    .onConflict((oc) => oc.column("play_cricket_id").doNothing())
    .execute();
}

async function seedFantasyTeam(
  userId: string,
  players: Array<{
    playerId: string;
    slotType: string;
    isCaptain?: boolean;
    isWicketkeeper?: boolean;
  }>,
) {
  const team = await ctx.db
    .insertInto("fantasy_team")
    .values({ user_id: userId, season: SEASON })
    .returning("id")
    .executeTakeFirstOrThrow();

  for (const p of players) {
    await ctx.db
      .insertInto("fantasy_team_player")
      .values({
        fantasy_team_id: team.id,
        play_cricket_id: p.playerId,
        slot_type: p.slotType,
        is_captain: p.isCaptain ?? false,
        is_wicketkeeper: p.isWicketkeeper ?? false,
        gameweek_added: 1,
        gameweek_removed: null,
      })
      .execute();
  }

  return team.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("calculateSlotEffectivePoints", () => {
  it("batting slot: only batting + fielding + team points", () => {
    const pts = calculateSlotEffectivePoints({
      slotType: "batting",
      isFantasyWk: false,
      battingPts: 50,
      bowlingPts: 30,
      fieldingPts: 10,
      teamPts: 10,
      catches: 1,
      stumpings: 0,
      isActualKeeper: false,
      isCaptain: false,
    });
    // batting(50) + fielding(10) + team(10) = 70, bowling excluded
    expect(pts).toBe(70);
  });

  it("bowling slot: only bowling + fielding + team points", () => {
    const pts = calculateSlotEffectivePoints({
      slotType: "bowling",
      isFantasyWk: false,
      battingPts: 50,
      bowlingPts: 30,
      fieldingPts: 10,
      teamPts: 10,
      catches: 1,
      stumpings: 0,
      isActualKeeper: false,
      isCaptain: false,
    });
    // bowling(30) + fielding(10) + team(10) = 50
    expect(pts).toBe(50);
  });

  it("allrounder slot: all categories", () => {
    const pts = calculateSlotEffectivePoints({
      slotType: "allrounder",
      isFantasyWk: false,
      battingPts: 50,
      bowlingPts: 30,
      fieldingPts: 10,
      teamPts: 10,
      catches: 1,
      stumpings: 0,
      isActualKeeper: false,
      isCaptain: false,
    });
    expect(pts).toBe(100);
  });

  it("captain gets 2x multiplier", () => {
    const pts = calculateSlotEffectivePoints({
      slotType: "batting",
      isFantasyWk: false,
      battingPts: 50,
      bowlingPts: 0,
      fieldingPts: 10,
      teamPts: 10,
      catches: 1,
      stumpings: 0,
      isActualKeeper: false,
      isCaptain: true,
    });
    expect(pts).toBe(140); // (50+10+10) * 2
  });

  it("WK slot adjusts catch rate for non-keeper", () => {
    const pts = calculateSlotEffectivePoints({
      slotType: "batting",
      isFantasyWk: true,
      battingPts: 0,
      bowlingPts: 0,
      fieldingPts: 20, // 2 catches at fielder rate (10 each)
      teamPts: 0,
      catches: 2,
      stumpings: 0,
      isActualKeeper: false,
      isCaptain: false,
    });
    // Adjustment: 2 * (5 - 10) = -10, so fieldingPts becomes 20 - 10 = 10
    expect(pts).toBe(10);
  });

  it("actual keeper not in WK slot forfeits catches and stumpings", () => {
    const pts = calculateSlotEffectivePoints({
      slotType: "bowling",
      isFantasyWk: false,
      battingPts: 0,
      bowlingPts: 30,
      fieldingPts: 20, // 2 catches at keeper rate (5 each) + 1 stumping (15)
      teamPts: 10,
      catches: 2,
      stumpings: 1,
      isActualKeeper: true,
      isCaptain: false,
    });
    // Forfeit: subtract 2*5 (catches) + 1*15 (stumpings) = 25
    // fieldingPts becomes 20 - 25 = -5
    // bowling(30) + fielding(-5) + team(10) = 35
    expect(pts).toBe(35);
  });
});

describe("calculateFantasyScores (integration)", () => {
  it("calculates player scores for a match with batting, bowling, fielding", async () => {
    const matchId = `m-${crypto.randomUUID()}`;
    const playerId = `p-${crypto.randomUUID()}`;

    await seedMatch(matchId);
    await seedBatting(matchId, playerId, {
      runs: 55,
      balls: 40,
      fours: 6,
      sixes: 1,
      notOut: false,
    });
    await seedBowling(matchId, playerId, {
      overs: "5",
      maidens: 0,
      runs: 15,
      wickets: 2,
    });
    await seedFielding(matchId, playerId, {
      catches: 1,
      runOuts: 0,
      stumpings: 0,
      isWicketkeeper: false,
    });

    const result = await calculateFantasyScores(ctx.db)(SEASON);
    expect(result.playerScoresUpserted).toBeGreaterThanOrEqual(1);

    const score = await ctx.db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playerId)
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    expect(score).toBeTruthy();

    // Batting: 55 runs + 6 fours + 1*2 sixes + 20 fifty bonus = 83
    expect(score?.batting_points).toBe(83);

    // Bowling: 2*10 wickets + 0 maidens + economy bonus (15/5=3.0 < 4.0, 5 overs >= 3) = 30
    expect(score?.bowling_points).toBe(30);

    // Fielding: 1 catch * 10 = 10
    expect(score?.fielding_points).toBe(10);

    // Win bonus
    expect(score?.team_points).toBe(SCORING.team.winBonus);
  });

  it("skips matches without results", async () => {
    const matchId = `m-noresult-${crypto.randomUUID()}`;
    const playerId = `p-noresult-${crypto.randomUUID()}`;

    // Seed batting but NO match_result
    await seedBatting(matchId, playerId, { runs: 100 });

    await calculateFantasyScores(ctx.db)(SEASON);

    const score = await ctx.db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playerId)
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    expect(score).toBeUndefined();
  });

  it("is idempotent — re-running produces same results", async () => {
    const matchId = `m-idem-${crypto.randomUUID()}`;
    const playerId = `p-idem-${crypto.randomUUID()}`;

    await seedMatch(matchId);
    await seedBatting(matchId, playerId, { runs: 30, fours: 3, sixes: 0 });

    await calculateFantasyScores(ctx.db)(SEASON);
    const first = await ctx.db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playerId)
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    await calculateFantasyScores(ctx.db)(SEASON);
    const second = await ctx.db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playerId)
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    expect(first?.batting_points).toBe(second?.batting_points);
    expect(first?.total_points).toBe(second?.total_points);
  });

  it("calculates team scores with slot-based filtering", async () => {
    const matchId = `m-team-${crypto.randomUUID()}`;
    const batterId = `p-bat-${crypto.randomUUID()}`;
    const bowlerId = `p-bowl-${crypto.randomUUID()}`;

    await seedMatch(matchId);

    // Batter: 50 runs, 5 fours, 1 six, catch
    await seedBatting(matchId, batterId, {
      runs: 50,
      balls: 35,
      fours: 5,
      sixes: 1,
      notOut: false,
    });
    await seedFielding(matchId, batterId, { catches: 1 });

    // Bowler: 3 wickets, 1 maiden
    await seedBowling(matchId, bowlerId, {
      overs: "8",
      maidens: 1,
      runs: 25,
      wickets: 3,
    });
    await seedFielding(matchId, bowlerId, { catches: 0 });

    await seedFantasyPlayer(batterId);
    await seedFantasyPlayer(bowlerId);

    const { userId } = await seedTestUser(ctx.db, {
      email: `team-${crypto.randomUUID()}@test.com`,
    });

    const teamId = await seedFantasyTeam(userId, [
      { playerId: batterId, slotType: "batting", isCaptain: true },
      { playerId: bowlerId, slotType: "bowling" },
    ]);

    const result = await calculateFantasyScores(ctx.db)(SEASON);
    expect(result.teamScoresUpserted).toBeGreaterThanOrEqual(1);

    const teamScore = await ctx.db
      .selectFrom("fantasy_team_score")
      .where("fantasy_team_id", "=", teamId)
      .where("season", "=", SEASON)
      .selectAll()
      .executeTakeFirst();

    expect(teamScore).toBeTruthy();
    // Batter (batting slot, captain 2x):
    //   batting = 50 runs + 5 fours + 1*2 sixes + 20 fifty bonus = 77
    //   fielding = 1 catch * 10 = 10
    //   team = 10 (win bonus)
    //   slot effective (batting) = 77 + 10 + 10 = 97, * 2 captain = 194
    // Bowler (bowling slot):
    //   bowling = 3*10 wickets + 15 three-wicket bonus + 1*10 maiden = 55
    //   economy = 25/8 = 3.125 < 4.0, so +10 = 65
    //   fielding = 0 catches * 10 = 0
    //   team = 10 (win bonus)
    //   slot effective (bowling) = 65 + 0 + 10 = 75
    // Total = 194 + 75 = 269
    expect(teamScore?.total_points).toBe(269);
  });

  it("applies duck penalty for 0 runs (not not-out)", async () => {
    const matchId = `m-duck-${crypto.randomUUID()}`;
    const playerId = `p-duck-${crypto.randomUUID()}`;

    await seedMatch(matchId);
    await seedBatting(matchId, playerId, {
      runs: 0,
      balls: 5,
      fours: 0,
      sixes: 0,
      notOut: false,
    });

    await calculateFantasyScores(ctx.db)(SEASON);

    const score = await ctx.db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playerId)
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    expect(score?.batting_points).toBe(SCORING.batting.duckPenalty);
  });

  it("no duck penalty for not-out on 0", async () => {
    const matchId = `m-noduck-${crypto.randomUUID()}`;
    const playerId = `p-noduck-${crypto.randomUUID()}`;

    await seedMatch(matchId);
    await seedBatting(matchId, playerId, {
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      notOut: true,
    });

    await calculateFantasyScores(ctx.db)(SEASON);

    const score = await ctx.db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playerId)
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    expect(score?.batting_points).toBe(0);
  });

  it("awards century bonus (not fifty bonus)", async () => {
    const matchId = `m-century-${crypto.randomUUID()}`;
    const playerId = `p-century-${crypto.randomUUID()}`;

    await seedMatch(matchId);
    await seedBatting(matchId, playerId, {
      runs: 105,
      balls: 90,
      fours: 12,
      sixes: 3,
      notOut: false,
    });

    await calculateFantasyScores(ctx.db)(SEASON);

    const score = await ctx.db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playerId)
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    // 105 runs + 12 fours + 3*2 sixes + 50 hundred bonus = 173
    expect(score?.batting_points).toBe(173);
  });
});
