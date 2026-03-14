import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
import { sql } from "kysely";
import {
  getCurrentSeason,
  getPreviousSeason,
  getCurrentGameweek,
  BUDGET,
  MAX_TRANSFERS_PER_GAMEWEEK,
} from "./gameweek.js";
import { SLOT_COUNTS } from "./scoring.js";
import type { PlayerInput } from "./schemas.js";

export function getEligiblePlayers(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();
    const previousSeason = getPreviousSeason(s);

    // Get eligible players with their sandwich cost
    const players = await db
      .selectFrom("fantasy_player")
      .where("eligible", "=", true)
      .selectAll()
      .execute();

    // Get previous season total points per player
    const previousPoints = await db
      .selectFrom("fantasy_player_score")
      .where("season", "=", previousSeason)
      .select([
        "play_cricket_id",
        sql<number>`sum(total_points)`.as("total_points"),
      ])
      .groupBy("play_cricket_id")
      .execute();

    const pointsMap = new Map(
      previousPoints.map((p) => [p.play_cricket_id, p.total_points]),
    );

    // Get ownership count: how many teams currently have each player
    const gameweek = getCurrentGameweek(s);
    const ownership = await db
      .selectFrom("fantasy_team_player")
      .innerJoin("fantasy_team", "fantasy_team.id", "fantasy_team_player.fantasy_team_id")
      .where("fantasy_team.season", "=", s)
      .where("fantasy_team_player.gameweek_added", "<=", gameweek)
      .where((eb) =>
        eb.or([
          eb("fantasy_team_player.gameweek_removed", "is", null),
          eb("fantasy_team_player.gameweek_removed", ">", gameweek),
        ]),
      )
      .select([
        "fantasy_team_player.play_cricket_id",
        sql<number>`count(distinct fantasy_team.id)`.as("team_count"),
      ])
      .groupBy("fantasy_team_player.play_cricket_id")
      .execute();

    const ownershipMap = new Map(
      ownership.map((o) => [o.play_cricket_id, o.team_count]),
    );

    // Get total number of teams for ownership percentage
    const teamCountResult = await db
      .selectFrom("fantasy_team")
      .where("season", "=", s)
      .select(sql<number>`count(*)`.as("total"))
      .executeTakeFirst();

    const totalTeams = teamCountResult?.total ?? 0;

    const enrichedPlayers = players.map((player) => ({
      ...player,
      previousSeasonPoints: pointsMap.get(player.play_cricket_id) ?? 0,
      ownershipPercent:
        totalTeams > 0
          ? Math.round(
              ((ownershipMap.get(player.play_cricket_id) ?? 0) / totalTeams) *
                100,
            )
          : 0,
    }));

    return {
      players: enrichedPlayers,
      season: s,
      previousSeason,
      budget: BUDGET,
    };
  };
}

export function getMyTeam(db: Kysely<DB>) {
  return async (userId: string, season?: string) => {
    const s = season ?? getCurrentSeason();
    const gameweek = getCurrentGameweek(s);

    const team = await db
      .selectFrom("fantasy_team")
      .where("user_id", "=", userId)
      .where("season", "=", s)
      .selectAll()
      .executeTakeFirst();

    if (!team) {
      return null;
    }

    // Get active players for the current gameweek
    const players = await db
      .selectFrom("fantasy_team_player")
      .innerJoin(
        "fantasy_player",
        "fantasy_player.play_cricket_id",
        "fantasy_team_player.play_cricket_id",
      )
      .where("fantasy_team_player.fantasy_team_id", "=", team.id)
      .where("fantasy_team_player.gameweek_added", "<=", gameweek)
      .where((eb) =>
        eb.or([
          eb("fantasy_team_player.gameweek_removed", "is", null),
          eb("fantasy_team_player.gameweek_removed", ">", gameweek),
        ]),
      )
      .selectAll("fantasy_team_player")
      .select([
        "fantasy_player.player_name",
        "fantasy_player.sandwich_cost",
        "fantasy_player.eligible",
      ])
      .execute();

    // Count transfers this gameweek
    const transfersResult = await db
      .selectFrom("fantasy_team_player")
      .where("fantasy_team_id", "=", team.id)
      .where("gameweek_added", "=", gameweek)
      .select(sql<number>`count(*)`.as("count"))
      .executeTakeFirst();

    const transfersUsed = transfersResult?.count ?? 0;

    // Check for chaos week
    const chaosWeek = await db
      .selectFrom("fantasy_chaos_week")
      .where("season", "=", s)
      .where("gameweek_id", "=", gameweek)
      .selectAll()
      .executeTakeFirst();

    return {
      team,
      players,
      gameweek,
      transfersUsed,
      maxTransfers: MAX_TRANSFERS_PER_GAMEWEEK,
      chaosWeek: chaosWeek ?? null,
    };
  };
}

export function saveTeam(db: Kysely<DB>) {
  return async (
    userId: string,
    players: PlayerInput[],
    season?: string,
  ) => {
    const s = season ?? getCurrentSeason();
    const gameweek = getCurrentGameweek(s);

    // Validate squad composition
    const slotCounts = { batting: 0, bowling: 0, fielding: 0 };
    let captainCount = 0;
    let wicketkeeperCount = 0;

    for (const player of players) {
      slotCounts[player.slotType]++;
      if (player.isCaptain) captainCount++;
      if (player.isWicketkeeper) wicketkeeperCount++;
    }

    if (slotCounts.batting !== SLOT_COUNTS.batting) {
      const error = new Error(
        `Must have exactly ${SLOT_COUNTS.batting} batting slots`,
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }
    if (slotCounts.bowling !== SLOT_COUNTS.bowling) {
      const error = new Error(
        `Must have exactly ${SLOT_COUNTS.bowling} bowling slots`,
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }
    if (slotCounts.fielding !== SLOT_COUNTS.fielding) {
      const error = new Error(
        `Must have exactly ${SLOT_COUNTS.fielding} fielding slots`,
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }
    if (captainCount !== 1) {
      const error = new Error(
        "Must have exactly 1 captain",
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }
    if (wicketkeeperCount > 1) {
      const error = new Error(
        "At most 1 wicketkeeper allowed",
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    // Validate budget
    const playCricketIds = players.map((p) => p.playCricketId);
    const dbPlayers = await db
      .selectFrom("fantasy_player")
      .where("play_cricket_id", "in", playCricketIds)
      .select(["play_cricket_id", "sandwich_cost"])
      .execute();

    const costMap = new Map(
      dbPlayers.map((p) => [p.play_cricket_id, p.sandwich_cost ?? 1]),
    );

    const totalCost = players.reduce(
      (sum, p) => sum + (costMap.get(p.playCricketId) ?? 1),
      0,
    );

    if (totalCost > BUDGET) {
      const error = new Error(
        `Team cost ${totalCost} exceeds budget of ${BUDGET}`,
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    // Check if team already exists
    const existingTeam = await db
      .selectFrom("fantasy_team")
      .where("user_id", "=", userId)
      .where("season", "=", s)
      .select(["id"])
      .executeTakeFirst();

    if (existingTeam) {
      // Handle as transfers: remove old players, add new ones
      // Mark current players as removed this gameweek
      await db
        .updateTable("fantasy_team_player")
        .set({ gameweek_removed: gameweek })
        .where("fantasy_team_id", "=", existingTeam.id)
        .where("gameweek_removed", "is", null)
        .execute();

      // Insert new players
      for (const player of players) {
        await db
          .insertInto("fantasy_team_player")
          .values({
            fantasy_team_id: existingTeam.id,
            play_cricket_id: player.playCricketId,
            is_captain: player.isCaptain,
            slot_type: player.slotType,
            is_wicketkeeper: player.isWicketkeeper,
            gameweek_added: gameweek,
            gameweek_removed: null,
          })
          .execute();
      }

      return { teamId: existingTeam.id, isNew: false };
    }

    // Create new team
    const newTeam = await db
      .insertInto("fantasy_team")
      .values({
        user_id: userId,
        season: s,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const player of players) {
      await db
        .insertInto("fantasy_team_player")
        .values({
          fantasy_team_id: newTeam.id,
          play_cricket_id: player.playCricketId,
          is_captain: player.isCaptain,
          slot_type: player.slotType,
          is_wicketkeeper: player.isWicketkeeper,
          gameweek_added: gameweek,
          gameweek_removed: null,
        })
        .execute();
    }

    return { teamId: newTeam.id, isNew: true };
  };
}

export function listPlayers(db: Kysely<DB>) {
  return async (search?: string) => {
    let query = db
      .selectFrom("fantasy_player")
      .selectAll()
      .orderBy("player_name", "asc");

    if (search) {
      query = query.where("player_name", "like", `%${search}%`);
    }

    const players = await query.execute();
    return { players };
  };
}

export function toggleEligibility(db: Kysely<DB>) {
  return async (playCricketId: string, eligible: boolean) => {
    await db
      .updateTable("fantasy_player")
      .set({ eligible })
      .where("play_cricket_id", "=", playCricketId)
      .execute();

    return { playCricketId, eligible };
  };
}

export function populatePlayers(db: Kysely<DB>) {
  return async () => {
    // Get distinct players from match performance tables
    const battingPlayers = await db
      .selectFrom("match_performance_batting")
      .select(["player_id", "player_name"])
      .distinct()
      .execute();

    const bowlingPlayers = await db
      .selectFrom("match_performance_bowling")
      .select(["player_id", "player_name"])
      .distinct()
      .execute();

    const fieldingPlayers = await db
      .selectFrom("match_performance_fielding")
      .select(["player_id", "player_name"])
      .distinct()
      .execute();

    // Merge all players by player_id
    const playerMap = new Map<string, string>();
    for (const p of [...battingPlayers, ...bowlingPlayers, ...fieldingPlayers]) {
      if (p.player_id && p.player_name) {
        playerMap.set(p.player_id, p.player_name);
      }
    }

    let inserted = 0;
    for (const [playerId, playerName] of playerMap) {
      // Upsert: insert if not exists
      const existing = await db
        .selectFrom("fantasy_player")
        .where("play_cricket_id", "=", playerId)
        .select(["play_cricket_id"])
        .executeTakeFirst();

      if (!existing) {
        await db
          .insertInto("fantasy_player")
          .values({
            play_cricket_id: playerId,
            player_name: playerName,
            eligible: false,
            sandwich_cost: 1,
          })
          .execute();
        inserted++;
      }
    }

    return { total: playerMap.size, inserted };
  };
}

export function calculateSandwichCosts(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();
    const previousSeason = getPreviousSeason(s);

    // Aggregate total points from previous season
    const playerPoints = await db
      .selectFrom("fantasy_player_score")
      .where("season", "=", previousSeason)
      .select([
        "play_cricket_id",
        sql<number>`sum(total_points)`.as("total_points"),
      ])
      .groupBy("play_cricket_id")
      .orderBy(sql`sum(points)`, "desc")
      .execute();

    if (playerPoints.length === 0) {
      return { updated: 0, season: s, previousSeason };
    }

    // Assign costs by percentile
    const total = playerPoints.length;
    let updated = 0;

    for (let i = 0; i < total; i++) {
      const percentile = i / total;
      let cost: number;

      if (percentile < 0.1) {
        cost = 5; // top 10%
      } else if (percentile < 0.25) {
        cost = 4;
      } else if (percentile < 0.5) {
        cost = 3;
      } else if (percentile < 0.75) {
        cost = 2;
      } else {
        cost = 1;
      }

      await db
        .updateTable("fantasy_player")
        .set({ sandwich_cost: cost })
        .where("play_cricket_id", "=", playerPoints[i].play_cricket_id)
        .execute();

      updated++;
    }

    return { updated, season: s, previousSeason };
  };
}
