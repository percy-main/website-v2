import assert from "node:assert";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { getHonoursBoard, getRecords } from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

const SENIOR_TEAM_ID = "team-records-1st";
const JUNIOR_TEAM_ID = "team-records-u15";

async function seedTeams() {
  await ctx.db
    .insertInto("play_cricket_team")
    .values([
      {
        id: SENIOR_TEAM_ID,
        name: "1st XI",
        site_id: "site-records",
        is_junior: false,
        last_updated: null,
      },
      {
        id: JUNIOR_TEAM_ID,
        name: "Under 15s",
        site_id: "site-records",
        is_junior: true,
        last_updated: null,
      },
    ])
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

async function seedMatchResult(overrides: {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  season: number;
  matchDate: string;
}) {
  await ctx.db
    .insertInto("match_result")
    .values({
      id: crypto.randomUUID(),
      match_id: overrides.matchId,
      home_team_id: overrides.homeTeamId,
      away_team_id: overrides.awayTeamId,
      home_team_name: overrides.homeTeamName,
      away_team_name: overrides.awayTeamName,
      season: overrides.season,
      match_date: overrides.matchDate,
    })
    .onConflict((oc) => oc.column("match_id").doNothing())
    .execute();
}

async function seedBattingPerformance(overrides: {
  matchId?: string;
  playerId: string;
  playerName: string;
  teamId: string;
  season: number;
  runs: number;
  balls?: number;
  notOut?: boolean;
  matchDate?: string;
}) {
  const matchId = overrides.matchId ?? `match-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("match_performance_batting")
    .values({
      id: crypto.randomUUID(),
      match_id: matchId,
      match_date: overrides.matchDate ?? "2024-06-15",
      player_id: overrides.playerId,
      player_name: overrides.playerName,
      team_id: overrides.teamId,
      season: overrides.season,
      runs: overrides.runs,
      balls: overrides.balls ?? 30,
      not_out: overrides.notOut ?? false,
    })
    .execute();
  return matchId;
}

async function seedBowlingPerformance(overrides: {
  matchId?: string;
  playerId: string;
  playerName: string;
  teamId: string;
  season: number;
  overs: string;
  runs: number;
  wickets: number;
  matchDate?: string;
}) {
  const matchId = overrides.matchId ?? `match-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("match_performance_bowling")
    .values({
      id: crypto.randomUUID(),
      match_id: matchId,
      match_date: overrides.matchDate ?? "2024-06-15",
      player_id: overrides.playerId,
      player_name: overrides.playerName,
      team_id: overrides.teamId,
      season: overrides.season,
      overs: overrides.overs,
      runs: overrides.runs,
      wickets: overrides.wickets,
    })
    .execute();
  return matchId;
}

describe("records service (integration)", () => {
  describe("getRecords", () => {
    it("returns highest individual score with opposition", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      const matchId = await seedBattingPerformance({
        playerId,
        playerName: "Top Scorer",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 185,
        notOut: true,
      });

      await seedMatchResult({
        matchId,
        homeTeamId: SENIOR_TEAM_ID,
        awayTeamId: "opp-team-1",
        homeTeamName: "Percy Main 1st XI",
        awayTeamName: "Benwell Hill",
        season: 2024,
        matchDate: "2024-06-15",
      });

      const result = await getRecords(ctx.db)({});
      assert(result.batting.highestScore, "Expected highest score record");
      expect(result.batting.highestScore.value).toBe("185*");
      expect(result.batting.highestScore.playerName).toBe("Top Scorer");
      expect(result.batting.highestScore.opposition).toBe("Benwell Hill");
    });

    it("returns best bowling figures", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      const matchId = await seedBowlingPerformance({
        playerId,
        playerName: "Top Bowler",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "10",
        runs: 22,
        wickets: 7,
      });

      await seedMatchResult({
        matchId,
        homeTeamId: "opp-team-2",
        awayTeamId: SENIOR_TEAM_ID,
        homeTeamName: "Tynemouth",
        awayTeamName: "Percy Main 1st XI",
        season: 2024,
        matchDate: "2024-06-20",
      });

      const result = await getRecords(ctx.db)({});
      assert(result.bowling.bestBowling, "Expected best bowling record");
      expect(result.bowling.bestBowling.value).toBe("7/22");
      expect(result.bowling.bestBowling.playerName).toBe("Top Bowler");
      expect(result.bowling.bestBowling.opposition).toBe("Tynemouth");
    });

    it("returns most runs in a season", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      for (let i = 0; i < 5; i++) {
        await seedBattingPerformance({
          playerId,
          playerName: "Season King",
          teamId: SENIOR_TEAM_ID,
          season: 2023,
          runs: 80,
        });
      }

      const result = await getRecords(ctx.db)({});
      assert(
        result.batting.mostRunsSeason,
        "Expected most runs in season record",
      );
      // 5 * 80 = 400
      expect(
        Number(result.batting.mostRunsSeason.value),
      ).toBeGreaterThanOrEqual(400);
      expect(result.batting.mostRunsSeason.season).toBe(2023);
    });

    it("returns career records", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      for (let season = 2020; season <= 2024; season++) {
        await seedBattingPerformance({
          playerId,
          playerName: "Career Player",
          teamId: SENIOR_TEAM_ID,
          season,
          runs: 50,
        });
      }

      const result = await getRecords(ctx.db)({});
      assert(result.batting.mostCareerRuns, "Expected career runs record");
      assert(
        result.batting.mostCareerMatches,
        "Expected career matches record",
      );
    });

    it("filters by junior/senior", async () => {
      await seedTeams();

      const seniorPlayer = `player-${crypto.randomUUID()}`;
      const juniorPlayer = `player-${crypto.randomUUID()}`;

      await seedBattingPerformance({
        playerId: seniorPlayer,
        playerName: "Senior Star",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 150,
      });
      await seedBattingPerformance({
        playerId: juniorPlayer,
        playerName: "Junior Star",
        teamId: JUNIOR_TEAM_ID,
        season: 2024,
        runs: 75,
      });

      const juniorResult = await getRecords(ctx.db)({ isJunior: true });
      assert(
        juniorResult.batting.highestScore,
        "Expected junior highest score",
      );
      expect(juniorResult.batting.highestScore.playerName).toBe("Junior Star");
    });
  });

  describe("getHonoursBoard", () => {
    it("returns centuries (100+ scores)", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      const matchId = await seedBattingPerformance({
        playerId,
        playerName: "Century Maker",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 142,
        notOut: true,
      });

      await seedMatchResult({
        matchId,
        homeTeamId: SENIOR_TEAM_ID,
        awayTeamId: "opp-team-3",
        homeTeamName: "Percy Main 1st XI",
        awayTeamName: "Whitley Bay",
        season: 2024,
        matchDate: "2024-07-01",
      });

      // Also seed a sub-100 score that should NOT appear
      await seedBattingPerformance({
        playerId,
        playerName: "Century Maker",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 95,
      });

      const result = await getHonoursBoard(ctx.db)({});
      const century = result.centuries.find(
        (c) => c.playerName === "Century Maker",
      );
      assert(century, "Expected century entry");
      expect(century.value).toBe("142*");
      expect(century.opposition).toBe("Whitley Bay");

      // Sub-100 should not appear
      const sub100 = result.centuries.filter(
        (c) => c.playerName === "Century Maker",
      );
      expect(sub100).toHaveLength(1);
    });

    it("returns five-wicket hauls (5+ wickets)", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      const matchId = await seedBowlingPerformance({
        playerId,
        playerName: "Fifer King",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "8",
        runs: 35,
        wickets: 6,
      });

      await seedMatchResult({
        matchId,
        homeTeamId: SENIOR_TEAM_ID,
        awayTeamId: "opp-team-4",
        homeTeamName: "Percy Main 1st XI",
        awayTeamName: "Backworth",
        season: 2024,
        matchDate: "2024-07-10",
      });

      // Also seed a 4-wicket haul that should NOT appear
      await seedBowlingPerformance({
        playerId,
        playerName: "Fifer King",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "7",
        runs: 28,
        wickets: 4,
      });

      const result = await getHonoursBoard(ctx.db)({});
      const fifer = result.fiveWicketHauls.find(
        (f) => f.playerName === "Fifer King",
      );
      assert(fifer, "Expected five-wicket haul entry");
      expect(fifer.value).toBe("6/35");
      expect(fifer.opposition).toBe("Backworth");

      // 4-wicket haul should not appear
      const sub5 = result.fiveWicketHauls.filter(
        (f) => f.playerName === "Fifer King",
      );
      expect(sub5).toHaveLength(1);
    });

    it("orders centuries by runs descending", async () => {
      await seedTeams();

      const player1 = `player-${crypto.randomUUID()}`;
      const player2 = `player-${crypto.randomUUID()}`;

      await seedBattingPerformance({
        playerId: player1,
        playerName: "Player A",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 110,
      });
      await seedBattingPerformance({
        playerId: player2,
        playerName: "Player B",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 160,
      });

      const result = await getHonoursBoard(ctx.db)({});
      const a = result.centuries.findIndex((c) => c.playerName === "Player A");
      const b = result.centuries.findIndex((c) => c.playerName === "Player B");
      expect(b).toBeLessThan(a);
    });
  });
});
