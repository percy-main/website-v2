import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { BUDGET, getCurrentSeason } from "./gameweek.ts";
import type { PlayerInput } from "./schemas.ts";
import { SLOT_COUNTS } from "./scoring.ts";
import {
  getEligiblePlayers,
  getMyTeam,
  populatePlayers,
  saveTeam,
  toggleEligibility,
} from "./service.ts";

// A weekday inside the cricket season (2026-04-22 = Wednesday). Used by
// describe blocks that exercise the weekend-lock-protected paths so they
// aren't dependent on the day the suite runs.
const IN_SEASON_WEEKDAY = new Date("2026-04-22T12:00:00Z");

function pinDateToWeekday() {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(IN_SEASON_WEEKDAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

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
    pinDateToWeekday();

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

  describe("versioned captain/slot/WK history", () => {
    // Two consecutive in-season edit-period Wednesdays. Under the 2026
    // season (GW1 starts Sat 2026-04-18), the gameweek rolls over on
    // each Monday 00:00 UK:
    //   Wed 2026-04-22 → GW2 (edit period for the Apr 25-26 weekend)
    //   Wed 2026-04-29 → GW3 (edit period for the May 2-3 weekend)
    const FIRST_WED = new Date("2026-04-22T12:00:00Z"); // gameweek 2
    const SECOND_WED = new Date("2026-04-29T12:00:00Z"); // gameweek 3

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function seedElevenPlayers() {
      const ids: string[] = [];
      for (let i = 0; i < 11; i++) {
        ids.push(await seedFantasyPlayer({ eligible: true, sandwichCost: 1 }));
      }
      return ids;
    }

    it("captain change in a later gameweek preserves the original captain on the closed row", async () => {
      vi.setSystemTime(FIRST_WED);
      const { userId } = await seedTestUser(ctx.db, {
        email: `cap-hist-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();
      const playerIds = await seedElevenPlayers();

      const { teamId } = await saveTeam(ctx.db)(
        userId,
        buildSquad(playerIds),
        season,
      );

      vi.setSystemTime(SECOND_WED);
      const capMoved = buildSquad(playerIds).map((p, i) => ({
        ...p,
        isCaptain: i === 1,
      }));
      await saveTeam(ctx.db)(userId, capMoved, season);

      const rows = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .where("play_cricket_id", "in", [playerIds[0], playerIds[1]])
        .orderBy("gameweek_added", "asc")
        .selectAll()
        .execute();

      const p0Early = rows.find(
        (r) => r.play_cricket_id === playerIds[0] && r.gameweek_added === 2,
      );
      const p0Late = rows.find(
        (r) => r.play_cricket_id === playerIds[0] && r.gameweek_added === 3,
      );
      const p1Early = rows.find(
        (r) => r.play_cricket_id === playerIds[1] && r.gameweek_added === 2,
      );
      const p1Late = rows.find(
        (r) => r.play_cricket_id === playerIds[1] && r.gameweek_added === 3,
      );

      expect(p0Early?.is_captain).toBe(true);
      expect(p0Early?.gameweek_removed).toBe(3);
      expect(p0Late?.is_captain).toBe(false);
      expect(p0Late?.gameweek_removed).toBeNull();

      expect(p1Early?.is_captain).toBe(false);
      expect(p1Early?.gameweek_removed).toBe(3);
      expect(p1Late?.is_captain).toBe(true);
      expect(p1Late?.gameweek_removed).toBeNull();

      // Reconstructed earlier-gameweek squad shows the original captain (11 players, 1 captain, p0)
      const earlyView = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .where("gameweek_added", "<=", 2)
        .where((eb) =>
          eb.or([
            eb("gameweek_removed", "is", null),
            eb("gameweek_removed", ">", 2),
          ]),
        )
        .selectAll()
        .execute();
      expect(earlyView).toHaveLength(11);
      const earlyCaptain = earlyView.find((r) => r.is_captain);
      expect(earlyCaptain?.play_cricket_id).toBe(playerIds[0]);
    });

    it("slot_type change in a later gameweek preserves the original slot on the closed row", async () => {
      vi.setSystemTime(FIRST_WED);
      const { userId } = await seedTestUser(ctx.db, {
        email: `slot-hist-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();
      const playerIds = await seedElevenPlayers();
      await saveTeam(ctx.db)(userId, buildSquad(playerIds), season);

      vi.setSystemTime(SECOND_WED);
      // Swap a batting slot (i=0) with a bowling slot (i=6) so the overall
      // squad still satisfies SLOT_COUNTS. Move WK off i=0 too, since WK
      // must be in a non-allrounder slot — i=0 is going to bowling, that's
      // fine. But we also move captain off 0 because captain is allowed in
      // either batting or bowling. Keeping captain on i=0 is valid.
      const swapped = buildSquad(playerIds).map((p, i) => {
        if (i === 0) return { ...p, slotType: "bowling" as const };
        if (i === 6) return { ...p, slotType: "batting" as const };
        return p;
      });
      await saveTeam(ctx.db)(userId, swapped, season);

      const rows = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("play_cricket_id", "in", [playerIds[0], playerIds[6]])
        .selectAll()
        .execute();

      const p0Early = rows.find(
        (r) => r.play_cricket_id === playerIds[0] && r.gameweek_added === 2,
      );
      const p0Late = rows.find(
        (r) => r.play_cricket_id === playerIds[0] && r.gameweek_added === 3,
      );
      const p6Early = rows.find(
        (r) => r.play_cricket_id === playerIds[6] && r.gameweek_added === 2,
      );
      const p6Late = rows.find(
        (r) => r.play_cricket_id === playerIds[6] && r.gameweek_added === 3,
      );

      expect(p0Early?.slot_type).toBe("batting");
      expect(p0Early?.gameweek_removed).toBe(3);
      expect(p0Late?.slot_type).toBe("bowling");
      expect(p6Early?.slot_type).toBe("bowling");
      expect(p6Early?.gameweek_removed).toBe(3);
      expect(p6Late?.slot_type).toBe("batting");
    });

    it("wicketkeeper change in a later gameweek preserves the original WK on the closed row", async () => {
      vi.setSystemTime(FIRST_WED);
      const { userId } = await seedTestUser(ctx.db, {
        email: `wk-hist-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();
      const playerIds = await seedElevenPlayers();
      await saveTeam(ctx.db)(userId, buildSquad(playerIds), season);

      vi.setSystemTime(SECOND_WED);
      // Move WK from i=0 (batting) to i=1 (batting).
      const wkMoved = buildSquad(playerIds).map((p, i) => ({
        ...p,
        isWicketkeeper: i === 1,
      }));
      await saveTeam(ctx.db)(userId, wkMoved, season);

      const p0Rows = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("play_cricket_id", "=", playerIds[0])
        .orderBy("gameweek_added", "asc")
        .selectAll()
        .execute();

      expect(p0Rows).toHaveLength(2);
      expect(p0Rows[0]?.gameweek_added).toBe(2);
      expect(p0Rows[0]?.is_wicketkeeper).toBe(true);
      expect(p0Rows[0]?.gameweek_removed).toBe(3);
      expect(p0Rows[1]?.gameweek_added).toBe(3);
      expect(p0Rows[1]?.is_wicketkeeper).toBe(false);
      expect(p0Rows[1]?.gameweek_removed).toBeNull();
    });

    it("multiple captain changes inside the same gameweek mutate in place (no row explosion)", async () => {
      vi.setSystemTime(FIRST_WED);
      const { userId } = await seedTestUser(ctx.db, {
        email: `same-gw-churn-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();
      const playerIds = await seedElevenPlayers();
      const { teamId } = await saveTeam(ctx.db)(
        userId,
        buildSquad(playerIds),
        season,
      );

      // Flip captain around within the same gameweek (row is still-open for this gameweek)
      for (const capIdx of [1, 2, 3, 4, 0]) {
        const s = buildSquad(playerIds).map((p, i) => ({
          ...p,
          isCaptain: i === capIdx,
        }));
        await saveTeam(ctx.db)(userId, s, season);
      }

      const rows = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .selectAll()
        .execute();
      expect(rows).toHaveLength(11);
    });

    it("config-only changes across gameweeks don't count as transfers", async () => {
      vi.setSystemTime(FIRST_WED);
      const { userId } = await seedTestUser(ctx.db, {
        email: `no-transfer-count-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();
      const playerIds = await seedElevenPlayers();
      await saveTeam(ctx.db)(userId, buildSquad(playerIds), season);

      vi.setSystemTime(SECOND_WED);
      // Captain move — no roster change
      const capMoved = buildSquad(playerIds).map((p, i) => ({
        ...p,
        isCaptain: i === 1,
      }));
      await saveTeam(ctx.db)(userId, capMoved, season);

      const team = await getMyTeam(ctx.db)(userId, season);
      expect(team.transfersUsed).toBe(0);
      expect(team.maxTransfers).toBe(3);
    });

    it("real transfers in a later gameweek count against the 3-per-gameweek limit", async () => {
      vi.setSystemTime(FIRST_WED);
      const { userId } = await seedTestUser(ctx.db, {
        email: `real-transfers-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();
      const playerIds = await seedElevenPlayers();
      const replacementIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        replacementIds.push(
          await seedFantasyPlayer({ eligible: true, sandwichCost: 1 }),
        );
      }
      await saveTeam(ctx.db)(userId, buildSquad(playerIds), season);

      vi.setSystemTime(SECOND_WED);
      // Swap out three players — within limit
      const threeOut = buildSquad([
        replacementIds[0],
        replacementIds[1],
        replacementIds[2],
        ...playerIds.slice(3),
      ]);
      await expect(
        saveTeam(ctx.db)(userId, threeOut, season),
      ).resolves.toBeDefined();

      const afterThree = await getMyTeam(ctx.db)(userId, season);
      expect(afterThree.transfersUsed).toBe(3);

      // Try to add a 4th — should reject
      const fourOut = buildSquad([
        replacementIds[0],
        replacementIds[1],
        replacementIds[2],
        replacementIds[3],
        ...playerIds.slice(4),
      ]);
      await expect(saveTeam(ctx.db)(userId, fourOut, season)).rejects.toThrow(
        /transfers per gameweek/,
      );
    });

    it("transfer + config change on a retained player in the same save both version correctly", async () => {
      vi.setSystemTime(FIRST_WED);
      const { userId } = await seedTestUser(ctx.db, {
        email: `mixed-edit-${crypto.randomUUID()}@test.com`,
      });
      const season = getCurrentSeason();
      const playerIds = await seedElevenPlayers();
      const replacement = await seedFantasyPlayer({
        eligible: true,
        sandwichCost: 1,
      });
      const { teamId } = await saveTeam(ctx.db)(
        userId,
        buildSquad(playerIds),
        season,
      );

      vi.setSystemTime(SECOND_WED);
      // In one save: swap player 10 (allrounder) for replacement, AND move
      // captain from 0 to 1 on retained players.
      const mixed = buildSquad([...playerIds.slice(0, 10), replacement]).map(
        (p, i) => ({
          ...p,
          isCaptain: i === 1,
        }),
      );
      await saveTeam(ctx.db)(userId, mixed, season);

      // Retained captain-swap players are versioned
      const p0Rows = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .where("play_cricket_id", "=", playerIds[0])
        .orderBy("gameweek_added", "asc")
        .selectAll()
        .execute();
      expect(p0Rows).toHaveLength(2);
      expect(p0Rows[0]?.is_captain).toBe(true);
      expect(p0Rows[0]?.gameweek_removed).toBe(3);
      expect(p0Rows[1]?.is_captain).toBe(false);

      // Transferred-out player: single row, closed this GW
      const p10Rows = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .where("play_cricket_id", "=", playerIds[10])
        .selectAll()
        .execute();
      expect(p10Rows).toHaveLength(1);
      expect(p10Rows[0]?.gameweek_removed).toBe(3);

      // New player: single row, added this GW
      const newRows = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .where("play_cricket_id", "=", replacement)
        .selectAll()
        .execute();
      expect(newRows).toHaveLength(1);
      expect(newRows[0]?.gameweek_added).toBe(3);
      expect(newRows[0]?.gameweek_removed).toBeNull();

      // Transfer count = 1 (only the real swap, not the captain move)
      const view = await getMyTeam(ctx.db)(userId, season);
      expect(view.transfersUsed).toBe(1);

      // Earlier-gameweek reconstruction: 11 original players with original captain
      const earlyView = await ctx.db
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .where("gameweek_added", "<=", 2)
        .where((eb) =>
          eb.or([
            eb("gameweek_removed", "is", null),
            eb("gameweek_removed", ">", 2),
          ]),
        )
        .selectAll()
        .execute();
      expect(earlyView).toHaveLength(11);
      expect(earlyView.find((r) => r.is_captain)?.play_cricket_id).toBe(
        playerIds[0],
      );
      expect(earlyView.map((r) => r.play_cricket_id).sort()).toEqual(
        [...playerIds].sort(),
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
