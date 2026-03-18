import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import { BUDGET, getCurrentSeason } from "./gameweek.js";
import type { PlayerInput } from "./schemas.js";
import { SLOT_COUNTS } from "./scoring.js";
import {
  getEligiblePlayers,
  getMyTeam,
  populatePlayers,
  saveTeam,
  toggleEligibility,
} from "./service.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
});

afterAll(async () => {
  await stopTestContainer(ctx);
});

/** Seed a fantasy_player row and return the play_cricket_id. */
async function seedFantasyPlayer(
  overrides: {
    playCricketId?: string;
    playerName?: string;
    eligible?: boolean;
    sandwichCost?: number;
  } = {},
) {
  const id = overrides.playCricketId ?? `pc-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("fantasy_player")
    .values({
      play_cricket_id: id,
      player_name: overrides.playerName ?? `Player ${id.slice(0, 6)}`,
      eligible: overrides.eligible ?? true,
      sandwich_cost: overrides.sandwichCost ?? 1,
    })
    .execute();
  return id;
}

/** Build a valid 11-player squad from an array of play_cricket_ids. */
function buildSquad(playerIds: string[]): PlayerInput[] {
  if (playerIds.length !== 11) throw new Error("Need exactly 11 player IDs");
  return playerIds.map((id, i) => ({
    playCricketId: id,
    isCaptain: i === 0,
    isWicketkeeper: i === 0,
    slotType:
      i < SLOT_COUNTS.batting
        ? "batting"
        : i < SLOT_COUNTS.batting + SLOT_COUNTS.bowling
          ? "bowling"
          : "allrounder",
  }));
}

describe("fantasy service (integration)", () => {
  describe("getEligiblePlayers", () => {
    it("returns empty players array when no fantasy players exist", async () => {
      // Use a season that won't collide with other tests' data
      const result = await getEligiblePlayers(ctx.db)("1900");
      expect(result.players).toEqual([]);
      expect(result.budget).toBe(BUDGET);
    });

    it("returns eligible players after seeding", async () => {
      const season = getCurrentSeason();
      const id1 = await seedFantasyPlayer({ eligible: true });
      const id2 = await seedFantasyPlayer({ eligible: true });
      // Ineligible player should not appear
      await seedFantasyPlayer({ eligible: false });

      const result = await getEligiblePlayers(ctx.db)(season);
      const returnedIds = result.players.map((p) => p.play_cricket_id);
      expect(returnedIds).toContain(id1);
      expect(returnedIds).toContain(id2);
      // All returned players should be eligible
      for (const p of result.players) {
        expect(p.eligible).toBe(true);
      }
    });
  });

  describe("getMyTeam", () => {
    it("returns null when user has no team", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `noteam-${crypto.randomUUID()}@test.com`,
      });
      const result = await getMyTeam(ctx.db)(userId);
      expect(result.team).toBeNull();
      expect(result.players).toEqual([]);
    });
  });

  describe("saveTeam", () => {
    it("creates a new team with 11 players", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `saveteam-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();

      // Seed 11 eligible players with cost 1 each
      const playerIds: string[] = [];
      for (let i = 0; i < 11; i++) {
        const id = await seedFantasyPlayer({
          eligible: true,
          sandwichCost: 1,
        });
        playerIds.push(id);
      }

      const squad = buildSquad(playerIds);
      const result = await saveTeam(ctx.db)(userId, squad, season);
      expect(result.isNew).toBe(true);
      expect(result.teamId).toBeTruthy();

      // Verify via getMyTeam
      const team = await getMyTeam(ctx.db)(userId, season);
      expect(team).not.toBeNull();
      expect(team?.players).toHaveLength(11);
    });

    it("rejects invalid squad composition (wrong slot counts)", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `badslots-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();

      const playerIds: string[] = [];
      for (let i = 0; i < 11; i++) {
        playerIds.push(
          await seedFantasyPlayer({ eligible: true, sandwichCost: 1 }),
        );
      }

      // All players as batting slots -- wrong composition
      const badSquad: PlayerInput[] = playerIds.map((id, i) => ({
        playCricketId: id,
        isCaptain: i === 0,
        isWicketkeeper: i === 0,
        slotType: "batting",
      }));

      await expect(saveTeam(ctx.db)(userId, badSquad, season)).rejects.toThrow(
        /batting slots/,
      );
    });

    it("rejects over-budget teams", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `overbudget-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();

      // Seed 11 expensive players (cost 10 each = 110 > 50 budget)
      const playerIds: string[] = [];
      for (let i = 0; i < 11; i++) {
        playerIds.push(
          await seedFantasyPlayer({ eligible: true, sandwichCost: 10 }),
        );
      }

      const squad = buildSquad(playerIds);
      await expect(saveTeam(ctx.db)(userId, squad, season)).rejects.toThrow(
        /budget exceeded/,
      );
    });
  });

  describe("toggleEligibility", () => {
    it("flips the eligible flag", async () => {
      const id = await seedFantasyPlayer({ eligible: true });

      await toggleEligibility(ctx.db)(id, false);
      const row = await ctx.db
        .selectFrom("fantasy_player")
        .where("play_cricket_id", "=", id)
        .select("eligible")
        .executeTakeFirst();
      expect(row?.eligible).toBe(false);

      await toggleEligibility(ctx.db)(id, true);
      const row2 = await ctx.db
        .selectFrom("fantasy_player")
        .where("play_cricket_id", "=", id)
        .select("eligible")
        .executeTakeFirst();
      expect(row2?.eligible).toBe(true);
    });
  });

  describe("populatePlayers", () => {
    it("inserts players from match performance data", async () => {
      const playerId = `pop-${crypto.randomUUID()}`;
      const playerName = `Populated Player ${playerId.slice(0, 6)}`;
      const matchId = `match-${crypto.randomUUID()}`;

      // Seed a batting performance row
      await ctx.db
        .insertInto("match_performance_batting")
        .values({
          id: crypto.randomUUID(),
          match_id: matchId,
          match_date: "2026-06-01",
          season: 2026,
          team_id: "team-1",
          player_id: playerId,
          player_name: playerName,
          runs: 50,
          balls: 40,
          fours: 5,
          sixes: 2,
          how_out: "caught",
          not_out: false,
          competition_type: "league",
        })
        .execute();

      const result = await populatePlayers(ctx.db)();
      expect(result.inserted).toBeGreaterThanOrEqual(1);

      // Verify the player was inserted
      const row = await ctx.db
        .selectFrom("fantasy_player")
        .where("play_cricket_id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      expect(row).toBeTruthy();
      expect(row?.player_name).toBe(playerName);
      expect(row?.eligible).toBe(false); // default
    });
  });
});
