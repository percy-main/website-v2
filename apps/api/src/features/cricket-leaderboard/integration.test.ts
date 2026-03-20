import assert from "node:assert";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { listBattingLeaderboard, listBowlingLeaderboard } from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

const SENIOR_TEAM_ID = "team-1st-xi";
const JUNIOR_TEAM_ID = "team-u15";

async function seedTeams() {
  await ctx.db
    .insertInto("play_cricket_team")
    .values([
      {
        id: SENIOR_TEAM_ID,
        name: "1st XI",
        site_id: "site-1",
        is_junior: false,
        last_updated: null,
      },
      {
        id: JUNIOR_TEAM_ID,
        name: "Under 15s",
        site_id: "site-1",
        is_junior: true,
        last_updated: null,
      },
    ])
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

async function seedMember(playCricketId: string, slug: string) {
  const id = `member-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("member")
    .values({
      id,
      email: `${id}@test.com`,
      play_cricket_id: playCricketId,
      slug,
    })
    .execute();
}

async function seedBattingPerformance(overrides: {
  playerId: string;
  playerName: string;
  teamId: string;
  season: number;
  runs: number;
  balls?: number;
  notOut?: boolean;
  fours?: number;
  sixes?: number;
  competitionType?: string;
}) {
  await ctx.db
    .insertInto("match_performance_batting")
    .values({
      id: crypto.randomUUID(),
      match_id: `match-${crypto.randomUUID()}`,
      match_date: "2024-06-15",
      player_id: overrides.playerId,
      player_name: overrides.playerName,
      team_id: overrides.teamId,
      season: overrides.season,
      runs: overrides.runs,
      balls: overrides.balls ?? 30,
      not_out: overrides.notOut ?? false,
      fours: overrides.fours ?? 0,
      sixes: overrides.sixes ?? 0,
      competition_type: overrides.competitionType ?? "League",
    })
    .execute();
}

async function seedBowlingPerformance(overrides: {
  playerId: string;
  playerName: string;
  teamId: string;
  season: number;
  overs: string;
  maidens?: number;
  runs: number;
  wickets: number;
  competitionType?: string;
}) {
  await ctx.db
    .insertInto("match_performance_bowling")
    .values({
      id: crypto.randomUUID(),
      match_id: `match-${crypto.randomUUID()}`,
      match_date: "2024-06-15",
      player_id: overrides.playerId,
      player_name: overrides.playerName,
      team_id: overrides.teamId,
      season: overrides.season,
      overs: overrides.overs,
      maidens: overrides.maidens ?? 0,
      runs: overrides.runs,
      wickets: overrides.wickets,
      competition_type: overrides.competitionType ?? "League",
    })
    .execute();
}

describe("cricket leaderboard service (integration)", () => {
  describe("listBattingLeaderboard", () => {
    it("aggregates batting stats grouped by player", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      // Two innings: 50 runs (30 balls, 2 fours, 1 six) + 100* runs (60 balls, 8 fours, 3 sixes)
      await seedBattingPerformance({
        playerId,
        playerName: "A Batsman",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 50,
        balls: 30,
        fours: 2,
        sixes: 1,
      });
      await seedBattingPerformance({
        playerId,
        playerName: "A Batsman",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 100,
        balls: 60,
        notOut: true,
        fours: 8,
        sixes: 3,
      });

      const result = await listBattingLeaderboard(ctx.db)({
        season: 2024,
        limit: 50,
      });

      const entry = result.entries.find((e) => e.playerId === playerId);
      assert(entry, "Expected batting entry for player");
      expect(entry.innings).toBe(2);
      expect(entry.runs).toBe(150);
      expect(entry.notOuts).toBe(1);
      expect(entry.highScore).toBe(100);
      expect(entry.fours).toBe(10);
      expect(entry.sixes).toBe(4);
      expect(entry.fifties).toBe(1);
      expect(entry.hundreds).toBe(1);
      // Only 2 innings, average not shown (requires 3+)
      expect(entry.average).toBeNull();
      // Strike rate: 150/90 * 100 = 166.67
      expect(entry.strikeRate).toBeCloseTo(166.67, 1);
    });

    it("calculates batting average when 3+ innings", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      for (let i = 0; i < 3; i++) {
        await seedBattingPerformance({
          playerId,
          playerName: "B Batsman",
          teamId: SENIOR_TEAM_ID,
          season: 2024,
          runs: 30,
          balls: 20,
        });
      }

      const result = await listBattingLeaderboard(ctx.db)({
        season: 2024,
        limit: 50,
      });

      const entry = result.entries.find((e) => e.playerId === playerId);
      assert(entry, "Expected batting entry for player");
      // 90 runs / 3 dismissals = 30.00
      expect(entry.average).toBe(30);
    });

    it("filters by junior/senior teams", async () => {
      await seedTeams();

      const seniorPlayer = `player-${crypto.randomUUID()}`;
      const juniorPlayer = `player-${crypto.randomUUID()}`;

      await seedBattingPerformance({
        playerId: seniorPlayer,
        playerName: "Senior Player",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 50,
      });
      await seedBattingPerformance({
        playerId: juniorPlayer,
        playerName: "Junior Player",
        teamId: JUNIOR_TEAM_ID,
        season: 2024,
        runs: 40,
      });

      const seniorsOnly = await listBattingLeaderboard(ctx.db)({
        season: 2024,
        isJunior: false,
        limit: 50,
      });
      const juniorsOnly = await listBattingLeaderboard(ctx.db)({
        season: 2024,
        isJunior: true,
        limit: 50,
      });

      expect(
        seniorsOnly.entries.find((e) => e.playerId === juniorPlayer),
      ).toBeUndefined();
      expect(
        juniorsOnly.entries.find((e) => e.playerId === seniorPlayer),
      ).toBeUndefined();
      expect(
        juniorsOnly.entries.find((e) => e.playerId === juniorPlayer),
      ).toBeTruthy();
    });

    it("filters by competition type", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      await seedBattingPerformance({
        playerId,
        playerName: "League Player",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 60,
        competitionType: "League",
      });
      await seedBattingPerformance({
        playerId,
        playerName: "League Player",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 20,
        competitionType: "Cup",
      });

      const leagueOnly = await listBattingLeaderboard(ctx.db)({
        season: 2024,
        competitionTypes: "League",
        limit: 50,
      });

      const entry = leagueOnly.entries.find((e) => e.playerId === playerId);
      assert(entry, "Expected batting entry for player");
      // Only the league innings (60 runs), not cup (20)
      expect(entry.runs).toBe(60);
      expect(entry.innings).toBe(1);
    });

    it("joins with member table for slug", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      const slug = `slug-${crypto.randomUUID()}`;
      await seedMember(playerId, slug);

      await seedBattingPerformance({
        playerId,
        playerName: "Linked Player",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        runs: 75,
      });

      const result = await listBattingLeaderboard(ctx.db)({
        season: 2024,
        limit: 50,
      });

      const entry = result.entries.find((e) => e.playerId === playerId);
      expect(entry?.slug).toBe(slug);
    });
  });

  describe("listBowlingLeaderboard", () => {
    it("aggregates bowling stats grouped by player", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      // Two spells: 5.3 overs, 1 maiden, 25 runs, 2 wickets + 7 overs, 2 maidens, 30 runs, 3 wickets
      await seedBowlingPerformance({
        playerId,
        playerName: "A Bowler",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "5.3",
        maidens: 1,
        runs: 25,
        wickets: 2,
      });
      await seedBowlingPerformance({
        playerId,
        playerName: "A Bowler",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "7",
        maidens: 2,
        runs: 30,
        wickets: 3,
      });

      const result = await listBowlingLeaderboard(ctx.db)({
        season: 2024,
        limit: 50,
      });

      const entry = result.entries.find((e) => e.playerId === playerId);
      assert(entry, "Expected bowling entry for player");
      expect(entry.matches).toBe(2);
      // 5.3 = 33 balls + 7.0 = 42 balls = 75 balls = 12.3 overs
      expect(entry.overs).toBe("12.3");
      expect(entry.maidens).toBe(3);
      expect(entry.runs).toBe(55);
      expect(entry.wickets).toBe(5);
      expect(entry.bestWickets).toBe(3);
      // Average: 55/5 = 11.00
      expect(entry.average).toBe(11);
      // Economy: 55/(75/6) = 4.40
      expect(entry.economy).toBe(4.4);
      // Strike rate: 75/5 = 15.0
      expect(entry.strikeRate).toBe(15);
    });

    it("does not show bowling average/SR when under 10 overs", async () => {
      await seedTeams();

      const playerId = `player-${crypto.randomUUID()}`;
      await seedBowlingPerformance({
        playerId,
        playerName: "Part Timer",
        teamId: SENIOR_TEAM_ID,
        season: 2024,
        overs: "3",
        runs: 15,
        wickets: 1,
      });

      const result = await listBowlingLeaderboard(ctx.db)({
        season: 2024,
        limit: 50,
      });

      const entry = result.entries.find((e) => e.playerId === playerId);
      assert(entry, "Expected bowling entry for player");
      // 18 balls < 60, so average and strike rate should be null
      expect(entry.average).toBeNull();
      expect(entry.strikeRate).toBeNull();
      // Economy should still show
      expect(entry.economy).toBeTruthy();
    });
  });
});
