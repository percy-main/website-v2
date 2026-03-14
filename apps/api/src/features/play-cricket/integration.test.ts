import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  seedTestUser,
  type TestContext,
} from "../../test/containers.js";
import { getTeams, getMatchDetail, getPlayerCareerStats } from "./service.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

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

      const result = await getMatchDetail(ctx.db)(matchId);
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
    it("returns null when no contentful link exists", async () => {
      const result = await getPlayerCareerStats(ctx.db)(
        `nonexistent-${crypto.randomUUID()}`,
      );
      expect(result).toBeNull();
    });

    it("returns null when member has no play_cricket_id", async () => {
      const email = `nopc-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      // Set contentful_entry_id but no play_cricket_id
      const contentfulId = `cf-${crypto.randomUUID()}`;
      await ctx.db
        .updateTable("member")
        .set({ contentful_entry_id: contentfulId, play_cricket_id: null })
        .where("id", "=", memberId!)
        .execute();

      const result = await getPlayerCareerStats(ctx.db)(contentfulId);
      expect(result).toBeNull();
    });

    it("aggregates batting and bowling stats correctly", async () => {
      const email = `career-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });

      const contentfulId = `cf-${crypto.randomUUID()}`;
      const playCricketId = `pc-${crypto.randomUUID()}`;

      await ctx.db
        .updateTable("member")
        .set({
          contentful_entry_id: contentfulId,
          play_cricket_id: playCricketId,
        })
        .where("id", "=", memberId!)
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

      const result = await getPlayerCareerStats(ctx.db)(contentfulId);
      expect(result).not.toBeNull();
      expect(result!.playCricketId).toBe(playCricketId);

      // Career batting totals
      expect(result!.career.batting.runs).toBe(150); // 50 + 100
      expect(result!.career.batting.matches).toBe(2);
      expect(result!.career.batting.highScore).toBe(100);
      expect(result!.career.batting.notOuts).toBe(1);

      // Career bowling totals
      expect(result!.career.bowling.wickets).toBe(3);
      expect(result!.career.bowling.runsConceded).toBe(30);
      expect(result!.career.bowling.innings).toBe(1);

      // Season breakdown
      expect(result!.battingBySeasonRows).toHaveLength(2);
      expect(result!.bowlingBySeasonRows).toHaveLength(1);
    });
  });
});
