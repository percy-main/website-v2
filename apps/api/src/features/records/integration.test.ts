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
    it("returns highest individual score", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      await seedBattingPerformance({
        playerId,
        playerName: "Top Scorer",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 185,
        notOut: true,
      });

      const result = await getRecords(ctx.db)({});
      const highest = result.records.find(
        (r) => r.title === "Highest Individual Score",
      );
      assert(highest, "Expected highest score record");
      expect(highest.value).toBe("185*");
      expect(highest.playerName).toBe("Top Scorer");
    });

    it("returns best bowling figures", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      await seedBowlingPerformance({
        playerId,
        playerName: "Top Bowler",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "10",
        runs: 22,
        wickets: 7,
      });

      const result = await getRecords(ctx.db)({});
      const best = result.records.find(
        (r) => r.title === "Best Bowling Figures",
      );
      assert(best, "Expected best bowling record");
      expect(best.value).toBe("7/22");
      expect(best.playerName).toBe("Top Bowler");
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
      const mostRuns = result.records.find(
        (r) => r.title === "Most Runs in a Season",
      );
      assert(mostRuns, "Expected most runs in season record");
      expect(Number(mostRuns.value)).toBeGreaterThanOrEqual(400);
      expect(mostRuns.season).toBe(2023);
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
      const careerRuns = result.records.find(
        (r) => r.title === "Most Career Runs",
      );
      const careerMatches = result.records.find(
        (r) => r.title === "Most Matches",
      );
      assert(careerRuns, "Expected career runs record");
      assert(careerMatches, "Expected career matches record");
    });

    it("filters by junior/senior", async () => {
      await seedTeams();

      const juniorPlayer = `player-${crypto.randomUUID()}`;

      await seedBattingPerformance({
        playerId: juniorPlayer,
        playerName: "Junior Star",
        teamId: JUNIOR_TEAM_ID,
        season: 2024,
        runs: 75,
      });

      const juniorResult = await getRecords(ctx.db)({ isJunior: true });
      const highest = juniorResult.records.find(
        (r) => r.title === "Highest Individual Score",
      );
      assert(highest, "Expected junior highest score");
      expect(highest.playerName).toBe("Junior Star");
    });
  });

  describe("getHonoursBoard", () => {
    it("returns centuries (100+ scores)", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      await seedBattingPerformance({
        playerId,
        playerName: "Century Maker",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 142,
        notOut: true,
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

      // Sub-100 should not appear
      const sub100 = result.centuries.filter(
        (c) => c.playerName === "Century Maker",
      );
      expect(sub100).toHaveLength(1);
    });

    it("returns five-wicket hauls (5+ wickets)", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      await seedBowlingPerformance({
        playerId,
        playerName: "Fifer King",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "8",
        runs: 35,
        wickets: 6,
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
