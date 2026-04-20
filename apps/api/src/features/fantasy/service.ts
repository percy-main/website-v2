/* eslint-disable @typescript-eslint/no-unnecessary-type-conversion -- PostgreSQL aggregates return bigint as string in node-pg; Number() is needed at runtime */
import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import { calculateSlotEffectivePoints } from "./calculate-scores.ts";
import {
  BUDGET,
  getCurrentGameweek,
  getCurrentSeason,
  getGameweekForDate,
  getGW1StartDate,
  getPreviousSeason,
  getTransferWindowInfo,
  isGameweekLocked,
  isPreSeason,
  MAX_TRANSFERS_PER_GAMEWEEK,
} from "./gameweek.ts";
import type { PlayerInput } from "./schemas.ts";
import {
  calculateBattingPoints,
  calculateBowlingPoints,
  calculateFieldingPoints,
  CHIP_TYPES,
  CHIPS,
  ELIGIBLE_TEAM_IDS,
  LEAGUE_COMPETITION_TYPES,
  SCORING,
  SLOT_COUNTS,
  type ChipType,
  type SlotType,
} from "./scoring.ts";

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
      .innerJoin(
        "fantasy_team",
        "fantasy_team.id",
        "fantasy_team_player.fantasy_team_id",
      )
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
      return {
        team: null,
        players: [],
        gameweek,
        transfersUsed: 0,
        maxTransfers: null, // No team yet = unlimited initial selection
        chaosWeek: null,
      };
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

    // Transfers used this gameweek = count of play_cricket_ids active at
    // `gameweek` that weren't active at `gameweek - 1`. Independent of
    // config-only row churn (captain/slot/WK) and of the order the user
    // made their swaps.
    const previousActive =
      gameweek <= 1
        ? []
        : await db
            .selectFrom("fantasy_team_player")
            .where("fantasy_team_id", "=", team.id)
            .where("gameweek_added", "<=", gameweek - 1)
            .where((eb) =>
              eb.or([
                eb("gameweek_removed", "is", null),
                eb("gameweek_removed", ">", gameweek - 1),
              ]),
            )
            .select("play_cricket_id")
            .execute();

    const previousActiveIds = new Set(
      previousActive.map((p) => p.play_cricket_id),
    );
    const isInitialSquad = previousActiveIds.size === 0;
    const transfersUsed = isInitialSquad
      ? 0
      : players.filter((p) => !previousActiveIds.has(p.play_cricket_id)).length;

    // Transfers are unlimited in pre-season or if this is the user's first squad
    const unlimitedTransfers = isPreSeason(s) || isInitialSquad;

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
      maxTransfers: unlimitedTransfers ? null : MAX_TRANSFERS_PER_GAMEWEEK,
      chaosWeek: chaosWeek ?? null,
    };
  };
}

export function saveTeam(db: Kysely<DB>) {
  return async (userId: string, players: PlayerInput[], season?: string) => {
    const s = season ?? getCurrentSeason();

    // Enforce lock (pre-season is never locked)
    if (isGameweekLocked(s)) {
      throw httpError(
        400,
        "Team editing is locked during match weekends (Saturday–Sunday). Editing reopens Monday.",
      );
    }

    const gameweek = getCurrentGameweek(s);

    // Check for active chaos week restrictions
    const chaosWeek = await getActiveChaosWeek(db, s, gameweek);

    // Validate squad composition
    const slotCounts = { batting: 0, bowling: 0, allrounder: 0 };
    let captainCount = 0;
    let wicketkeeperCount = 0;

    for (const player of players) {
      slotCounts[player.slotType]++;
      if (player.isCaptain) captainCount++;
      if (player.isWicketkeeper) wicketkeeperCount++;
    }

    if (slotCounts.batting !== SLOT_COUNTS.batting) {
      throw httpError(
        400,
        `Must have exactly ${SLOT_COUNTS.batting} batting slots`,
      );
    }
    if (slotCounts.bowling !== SLOT_COUNTS.bowling) {
      throw httpError(
        400,
        `Must have exactly ${SLOT_COUNTS.bowling} bowling slots`,
      );
    }
    if (slotCounts.allrounder !== SLOT_COUNTS.allrounder) {
      throw httpError(
        400,
        `Must have exactly ${SLOT_COUNTS.allrounder} allrounder slots`,
      );
    }
    if (captainCount !== 1) {
      throw httpError(400, "Exactly one player must be designated as captain.");
    }
    if (wicketkeeperCount !== 1) {
      throw httpError(
        400,
        "Exactly one player must be designated as wicketkeeper.",
      );
    }

    // No duplicate players
    const playerIds = new Set(players.map((p) => p.playCricketId));
    if (playerIds.size !== 11) {
      throw httpError(400, "All 11 players must be different.");
    }

    // Captain cannot be in allrounder slot
    const captain = players.find((p) => p.isCaptain);
    if (captain?.slotType === "allrounder") {
      throw httpError(
        400,
        "The captain cannot be placed in the all-rounder slot.",
      );
    }

    // Validate all players are eligible and get their sandwich costs
    const eligiblePlayers = await db
      .selectFrom("fantasy_player")
      .where("play_cricket_id", "in", Array.from(playerIds))
      .where("eligible", "=", true)
      .select(["play_cricket_id", "sandwich_cost"])
      .execute();

    if (eligiblePlayers.length !== 11) {
      throw httpError(
        400,
        "All selected players must be eligible for fantasy cricket.",
      );
    }

    // Validate budget
    const costMap = new Map(
      eligiblePlayers.map((p) => [p.play_cricket_id, p.sandwich_cost ?? 1]),
    );
    const totalCost = players.reduce(
      (sum, p) => sum + (costMap.get(p.playCricketId) ?? 1),
      0,
    );
    if (totalCost > BUDGET) {
      throw httpError(
        400,
        `Team sandwich budget exceeded. Total cost: ${totalCost}, budget: ${BUDGET}.`,
      );
    }

    // Use a transaction for atomicity
    return await db.transaction().execute(async (trx) => {
      const existingTeam = await trx
        .selectFrom("fantasy_team")
        .where("user_id", "=", userId)
        .where("season", "=", s)
        .select("id")
        .executeTakeFirst();

      if (!existingTeam) {
        // New team — initial squad, no transfer limits
        const result = await trx
          .insertInto("fantasy_team")
          .values({ user_id: userId, season: s })
          .returning("id")
          .executeTakeFirstOrThrow();

        for (const player of players) {
          await trx
            .insertInto("fantasy_team_player")
            .values({
              fantasy_team_id: result.id,
              play_cricket_id: player.playCricketId,
              is_captain: player.isCaptain,
              gameweek_added: gameweek,
              slot_type: player.slotType,
              is_wicketkeeper: player.isWicketkeeper,
            })
            .execute();
        }

        return { teamId: result.id, isNew: true };
      }

      // Existing team — handle transfers
      const teamId = existingTeam.id;

      const currentPlayers = await trx
        .selectFrom("fantasy_team_player")
        .where("fantasy_team_id", "=", teamId)
        .where("gameweek_added", "<=", gameweek)
        .where((eb) =>
          eb.or([
            eb("gameweek_removed", "is", null),
            eb("gameweek_removed", ">", gameweek),
          ]),
        )
        .selectAll()
        .execute();

      const currentPlayerIds = new Set(
        currentPlayers.map((p) => p.play_cricket_id),
      );
      const newPlayerIds = new Set(players.map((p) => p.playCricketId));

      const playersToAdd = players.filter(
        (p) => !currentPlayerIds.has(p.playCricketId),
      );
      const playersToRemove = currentPlayers.filter(
        (p) => !newPlayerIds.has(p.play_cricket_id),
      );

      // Chaos week: no transfers
      if (chaosWeek?.rule_type === "no_transfers") {
        const hasTransfer =
          playersToAdd.length > 0 || playersToRemove.length > 0;
        if (hasTransfer) {
          throw httpError(
            400,
            `Chaos week: "${chaosWeek.name}" — no transfers allowed this gameweek! You can still change captain, slots, and wicketkeeper.`,
          );
        }
      }

      // Chaos week: no captain change
      if (chaosWeek?.rule_type === "no_captain_change") {
        const currentCaptain = currentPlayers.find((p) => p.is_captain);
        const newCaptain = players.find((p) => p.isCaptain);
        if (
          currentCaptain &&
          newCaptain &&
          currentCaptain.play_cricket_id !== newCaptain.playCricketId
        ) {
          throw httpError(
            400,
            `Chaos week: "${chaosWeek.name}" — captain cannot be changed this gameweek!`,
          );
        }
      }

      // Check transfer limit in-season. A transfer is any play_cricket_id
      // active at `gameweek` that wasn't active at `gameweek - 1`. This is
      // independent of how many config-only row churns (captain/slot/WK)
      // have occurred this gameweek, and independent of the order in which
      // the user made their swaps.
      if (!isPreSeason(s) && gameweek > 1) {
        const previousActive = await trx
          .selectFrom("fantasy_team_player")
          .where("fantasy_team_id", "=", teamId)
          .where("gameweek_added", "<=", gameweek - 1)
          .where((eb) =>
            eb.or([
              eb("gameweek_removed", "is", null),
              eb("gameweek_removed", ">", gameweek - 1),
            ]),
          )
          .select("play_cricket_id")
          .execute();

        const previousActiveIds = new Set(
          previousActive.map((p) => p.play_cricket_id),
        );

        if (previousActiveIds.size > 0) {
          const netTransfers = Array.from(newPlayerIds).filter(
            (id) => !previousActiveIds.has(id),
          ).length;

          if (netTransfers > MAX_TRANSFERS_PER_GAMEWEEK) {
            throw httpError(
              400,
              `You can only make ${MAX_TRANSFERS_PER_GAMEWEEK} transfers per gameweek.`,
            );
          }
        }
      }

      // Apply removals
      for (const player of playersToRemove) {
        await trx
          .updateTable("fantasy_team_player")
          .set({ gameweek_removed: gameweek })
          .where("id", "=", player.id)
          .execute();
      }

      // Apply additions
      for (const player of playersToAdd) {
        await trx
          .insertInto("fantasy_team_player")
          .values({
            fantasy_team_id: teamId,
            play_cricket_id: player.playCricketId,
            is_captain: player.isCaptain,
            gameweek_added: gameweek,
            slot_type: player.slotType,
            is_wicketkeeper: player.isWicketkeeper,
          })
          .execute();
      }

      // Update captain, slot_type, and is_wicketkeeper for retained players.
      //
      // Key rule for historical reconstruction: when a row was added in a
      // prior (now-locked) gameweek, we must NOT mutate its flags in place,
      // or we destroy the snapshot used to rescore that past gameweek.
      // Instead, close the existing row (gameweek_removed = current gw) and
      // insert a new row (gameweek_added = current gw) carrying the new
      // flags. Rows added in the current gameweek are still open — mutating
      // them in place is safe and avoids row explosion for repeated edits
      // within the same gameweek.
      for (const player of players) {
        if (!currentPlayerIds.has(player.playCricketId)) continue;
        const existing = currentPlayers.find(
          (p) => p.play_cricket_id === player.playCricketId,
        );
        if (!existing) continue;

        const captainChanged = existing.is_captain !== player.isCaptain;
        const slotChanged = existing.slot_type !== player.slotType;
        const wkChanged = existing.is_wicketkeeper !== player.isWicketkeeper;
        if (!captainChanged && !slotChanged && !wkChanged) continue;

        if (existing.gameweek_added === gameweek) {
          await trx
            .updateTable("fantasy_team_player")
            .set({
              is_captain: player.isCaptain,
              slot_type: player.slotType,
              is_wicketkeeper: player.isWicketkeeper,
            })
            .where("id", "=", existing.id)
            .execute();
        } else {
          await trx
            .updateTable("fantasy_team_player")
            .set({ gameweek_removed: gameweek })
            .where("id", "=", existing.id)
            .execute();
          await trx
            .insertInto("fantasy_team_player")
            .values({
              fantasy_team_id: teamId,
              play_cricket_id: player.playCricketId,
              is_captain: player.isCaptain,
              gameweek_added: gameweek,
              slot_type: player.slotType,
              is_wicketkeeper: player.isWicketkeeper,
            })
            .execute();
        }
      }

      return { teamId, isNew: false };
    });
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

export function populatePlayers(
  db: Kysely<DB>,
  apiClient?: PlayCricketApiClient,
) {
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
    for (const p of [
      ...battingPlayers,
      ...bowlingPlayers,
      ...fieldingPlayers,
    ]) {
      if (p.player_id && p.player_name) {
        playerMap.set(p.player_id, p.player_name);
      }
    }

    // Also fetch all registered players from Play Cricket API
    if (apiClient) {
      const { players: apiPlayers } = await apiClient.getPlayers();
      for (const p of apiPlayers) {
        const id = String(p.member_id);
        if (!playerMap.has(id)) {
          playerMap.set(id, p.name);
        }
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
      .orderBy(sql`sum(total_points)`, "desc")
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpError(statusCode: number, message: string): Error {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  throw error;
}

/**
 * Assign standard competition ranking (1224) to sorted entries.
 * Entries with the same score get the same rank.
 */
function assignRanks<T>(
  entries: T[],
  getScore: (entry: T) => number,
): Array<T & { rank: number }> {
  let currentRank = 1;
  return entries.map((entry, i) => {
    const prev = entries[i - 1];
    if (i > 0 && prev !== undefined && getScore(entry) < getScore(prev)) {
      currentRank = i + 1;
    }
    return { ...entry, rank: currentRank };
  });
}

async function getActiveChaosWeek(
  db: Kysely<DB>,
  season: string,
  gameweek: number,
) {
  if (gameweek === 0) return null;
  return (
    (await db
      .selectFrom("fantasy_chaos_week")
      .where("season", "=", season)
      .where("gameweek_id", "=", gameweek)
      .selectAll()
      .executeTakeFirst()) ?? null
  );
}

interface OwnershipEntry {
  ownerCount: number;
  captainCount: number;
  ownershipPct: number;
  captainPct: number;
}

async function getOwnershipData(
  db: Kysely<DB>,
  season: string,
  gameweek: number,
): Promise<{ ownershipMap: Map<string, OwnershipEntry>; teamCount: number }> {
  const playerOwnership = await db
    .selectFrom("fantasy_team_player as ftp")
    .innerJoin("fantasy_team as ft", "ft.id", "ftp.fantasy_team_id")
    .where("ft.season", "=", season)
    .where("ftp.gameweek_added", "<=", gameweek)
    .where((eb) =>
      eb.or([
        eb("ftp.gameweek_removed", "is", null),
        eb("ftp.gameweek_removed", ">", gameweek),
      ]),
    )
    .select([
      "ftp.play_cricket_id",
      sql<string>`COUNT(DISTINCT ftp.fantasy_team_id)`.as("owner_count"),
      sql<string>`COUNT(DISTINCT CASE WHEN ftp.is_captain = true THEN ftp.fantasy_team_id END)`.as(
        "captain_count",
      ),
    ])
    .groupBy("ftp.play_cricket_id")
    .execute();

  const totalTeams = await db
    .selectFrom("fantasy_team")
    .where("season", "=", season)
    .select(sql<string>`COUNT(*)`.as("count"))
    .executeTakeFirst();

  const teamCount = Number(totalTeams?.count ?? 0);

  const ownershipMap = new Map<string, OwnershipEntry>();
  for (const row of playerOwnership) {
    ownershipMap.set(row.play_cricket_id, {
      ownerCount: Number(row.owner_count),
      captainCount: Number(row.captain_count),
      ownershipPct:
        teamCount > 0
          ? Math.round((Number(row.owner_count) / teamCount) * 100)
          : 0,
      captainPct:
        teamCount > 0
          ? Math.round((Number(row.captain_count) / teamCount) * 100)
          : 0,
    });
  }

  return { ownershipMap, teamCount };
}

/**
 * Calculate total fantasy points from raw match performance data for given seasons.
 * Used as a fallback when fantasy_player_score has no data (e.g. pre-season).
 * Matches v1's calculateSeasonPoints().
 */
/**
 * Parse a match date string into a Date for gameweek filtering.
 * Handles DD/MM/YYYY (Play-Cricket sync format) and YYYY-MM-DD (ISO).
 */
function parseMatchDateForFilter(dateStr: string): Date | null {
  if (dateStr.includes("/")) {
    const [dd, mm, yyyy] = dateStr.split("/");
    return new Date(
      Date.UTC(
        parseInt(yyyy ?? "0"),
        parseInt(mm ?? "1") - 1,
        parseInt(dd ?? "1"),
      ),
    );
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

async function calculateSeasonPointsFromMatches(
  db: Kysely<DB>,
  seasons: string[],
): Promise<Map<string, { totalPoints: number; matchesPlayed: number }>> {
  const eligibleTeamIds = Array.from(ELIGIBLE_TEAM_IDS);
  const leagueTypes = Array.from(LEAGUE_COMPETITION_TYPES);
  const numericSeasons = seasons.map(Number);

  const [battingPerfs, bowlingPerfs, fieldingPerfs, matchResults] =
    await Promise.all([
      db
        .selectFrom("match_performance_batting")
        .where("season", "in", numericSeasons)
        .where("team_id", "in", eligibleTeamIds)
        .where("competition_type", "in", leagueTypes)
        .select([
          "player_id",
          "match_id",
          "match_date",
          "season",
          "team_id",
          "runs",
          "balls",
          "fours",
          "sixes",
          "not_out",
        ])
        .execute(),
      db
        .selectFrom("match_performance_bowling")
        .where("season", "in", numericSeasons)
        .where("team_id", "in", eligibleTeamIds)
        .where("competition_type", "in", leagueTypes)
        .select([
          "player_id",
          "match_id",
          "match_date",
          "season",
          "team_id",
          "overs",
          "maidens",
          "runs",
          "wickets",
        ])
        .execute(),
      db
        .selectFrom("match_performance_fielding")
        .where("season", "in", numericSeasons)
        .where("team_id", "in", eligibleTeamIds)
        .where("competition_type", "in", leagueTypes)
        .select([
          "player_id",
          "match_id",
          "match_date",
          "season",
          "team_id",
          "catches",
          "run_outs",
          "stumpings",
          "is_wicketkeeper",
        ])
        .execute(),
      db
        .selectFrom("match_result")
        .where("season", "in", numericSeasons)
        .where("competition_type", "in", leagueTypes)
        .select(["match_id", "result_applied_to"])
        .execute(),
    ]);

  const winnerByMatch = new Map<string, string>();
  for (const r of matchResults) {
    if (r.result_applied_to) winnerByMatch.set(r.match_id, r.result_applied_to);
  }

  const mkKey = (playerId: string, matchId: string) => `${playerId}:${matchId}`;

  const battingByMatch = new Map<string, (typeof battingPerfs)[0]>();
  for (const b of battingPerfs)
    battingByMatch.set(mkKey(b.player_id, b.match_id), b);

  const bowlingByMatch = new Map<string, (typeof bowlingPerfs)[0]>();
  for (const b of bowlingPerfs)
    bowlingByMatch.set(mkKey(b.player_id, b.match_id), b);

  const fieldingByMatch = new Map<string, (typeof fieldingPerfs)[0]>();
  for (const f of fieldingPerfs)
    fieldingByMatch.set(mkKey(f.player_id, f.match_id), f);

  interface Appearance {
    playerId: string;
    matchId: string;
    matchDate: string;
    season: number;
    teamId: string;
  }
  const appearances = new Map<string, Appearance>();
  for (const b of battingPerfs) {
    const k = mkKey(b.player_id, b.match_id);
    if (!appearances.has(k))
      appearances.set(k, {
        playerId: b.player_id,
        matchId: b.match_id,
        matchDate: b.match_date,
        season: b.season,
        teamId: b.team_id,
      });
  }
  for (const b of bowlingPerfs) {
    const k = mkKey(b.player_id, b.match_id);
    if (!appearances.has(k))
      appearances.set(k, {
        playerId: b.player_id,
        matchId: b.match_id,
        matchDate: b.match_date,
        season: b.season,
        teamId: b.team_id,
      });
  }
  for (const f of fieldingPerfs) {
    const k = mkKey(f.player_id, f.match_id);
    if (!appearances.has(k))
      appearances.set(k, {
        playerId: f.player_id,
        matchId: f.match_id,
        matchDate: f.match_date,
        season: f.season,
        teamId: f.team_id,
      });
  }

  const result = new Map<
    string,
    { totalPoints: number; matchesPlayed: number }
  >();

  for (const [mk, app] of appearances) {
    // Skip matches outside the fantasy calendar (same gate as calculate-scores.ts)
    const matchDate = parseMatchDateForFilter(app.matchDate);
    if (
      matchDate &&
      getGameweekForDate(matchDate, String(app.season)) === null
    ) {
      continue;
    }

    const bat = battingByMatch.get(mk);
    const bowl = bowlingByMatch.get(mk);
    const field = fieldingByMatch.get(mk);

    let matchPoints = 0;

    if (bat) {
      matchPoints += calculateBattingPoints({
        runs: bat.runs,
        balls: bat.balls,
        fours: bat.fours,
        sixes: bat.sixes,
        notOut: Boolean(bat.not_out),
      }).total;
    }

    if (bowl) {
      matchPoints += calculateBowlingPoints({
        overs: bowl.overs,
        maidens: bowl.maidens,
        runs: bowl.runs,
        wickets: bowl.wickets,
      }).total;
    }

    if (field) {
      matchPoints += calculateFieldingPoints({
        catches: field.catches,
        runOuts: field.run_outs,
        stumpings: field.stumpings,
        isWicketkeeper: Boolean(field.is_wicketkeeper),
      }).total;
    }

    const winner = winnerByMatch.get(app.matchId);
    if (winner === app.teamId) {
      matchPoints += SCORING.team.winBonus;
    }

    const existing = result.get(app.playerId) ?? {
      totalPoints: 0,
      matchesPlayed: 0,
    };
    existing.totalPoints += matchPoints;
    existing.matchesPlayed += 1;
    result.set(app.playerId, existing);
  }

  return result;
}

function getDifferentialThreshold(teamCount: number): number {
  if (teamCount <= 1) return 100;
  // Ensure at least single-owner players can qualify (e.g. 1/3 teams = 34%)
  const minSingleOwnerPct = Math.ceil(100 / teamCount);
  return Math.max(
    minSingleOwnerPct,
    Math.max(10, Math.min(20, 30 - teamCount)),
  );
}

function rankDifferentials(
  ownershipMap: Map<string, OwnershipEntry>,
  teamCount: number,
  pointsMap: Map<string, { playerName: string; points: number }>,
  limit: number,
  costMap?: Map<string, number>,
): Array<{
  playCricketId: string;
  playerName: string;
  points: number;
  ownershipPct: number;
  sandwichCost: number;
}> {
  const threshold = getDifferentialThreshold(teamCount);
  const candidates: Array<{
    playCricketId: string;
    playerName: string;
    points: number;
    ownershipPct: number;
    sandwichCost: number;
    diffValue: number;
  }> = [];

  for (const [id, entry] of ownershipMap) {
    if (entry.ownershipPct <= 0 || entry.ownershipPct > threshold) continue;
    const pts = pointsMap.get(id);
    if (!pts || pts.points <= 0) continue;
    candidates.push({
      playCricketId: id,
      playerName: pts.playerName,
      points: pts.points,
      ownershipPct: entry.ownershipPct,
      sandwichCost: costMap?.get(id) ?? 0,
      diffValue: pts.points * (1 - entry.ownershipPct / 100),
    });
  }

  return candidates
    .sort(
      (a, b) => b.diffValue - a.diffValue || a.ownershipPct - b.ownershipPct,
    )
    .slice(0, limit)
    .map(
      ({ playCricketId, playerName, points, ownershipPct, sandwichCost }) => ({
        playCricketId,
        playerName,
        points,
        ownershipPct,
        sandwichCost,
      }),
    );
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

export function getTransferWindow() {
  return (season?: string) => {
    const s = season ?? getCurrentSeason();
    return getTransferWindowInfo(s);
  };
}

export function getChaosWeekPublic(db: Kysely<DB>) {
  return async (season?: string, gameweek?: number) => {
    const s = season ?? getCurrentSeason();
    const gw = gameweek ?? getCurrentGameweek(s);
    return await getActiveChaosWeek(db, s, gw);
  };
}

export function getPreSeasonStats(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();

    const teamCount = await db
      .selectFrom("fantasy_team")
      .where("season", "=", s)
      .select(sql<string>`COUNT(*)`.as("count"))
      .executeTakeFirstOrThrow();

    const sandwichTotal = await db
      .selectFrom("fantasy_team_player as ftp")
      .innerJoin("fantasy_team as ft", "ft.id", "ftp.fantasy_team_id")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "ftp.play_cricket_id",
      )
      .where("ft.season", "=", s)
      .where("ftp.gameweek_removed", "is", null)
      .select(sql<string>`COALESCE(SUM(fp.sandwich_cost), 0)`.as("total"))
      .executeTakeFirstOrThrow();

    return {
      teamCount: Number(teamCount.count),
      totalSandwiches: Number(sandwichTotal.total),
    };
  };
}

export function getOwnershipOverview(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();
    const gameweek = getCurrentGameweek(s);

    const { ownershipMap, teamCount } = await getOwnershipData(db, s, gameweek);

    if (teamCount === 0) {
      return {
        mostOwned: [],
        mostCaptained: [],
        differentials: [],
        teamCount: 0,
        gameweek,
        isFromPreviousSeason: false,
      };
    }

    const playerIds = Array.from(ownershipMap.keys());
    const playerInfo =
      playerIds.length > 0
        ? await db
            .selectFrom("fantasy_player")
            .where("play_cricket_id", "in", playerIds)
            .select(["play_cricket_id", "player_name", "sandwich_cost"])
            .execute()
        : [];

    const nameMap = new Map<string, string>();
    const costMap = new Map<string, number>();
    for (const p of playerInfo) {
      nameMap.set(p.play_cricket_id, p.player_name);
      costMap.set(p.play_cricket_id, p.sandwich_cost);
    }

    const entries = Array.from(ownershipMap.entries()).map(([id, data]) => ({
      playCricketId: id,
      playerName: nameMap.get(id) ?? "Unknown",
      ...data,
    }));

    const mostOwned = [...entries]
      .sort(
        (a, b) =>
          b.ownerCount - a.ownerCount ||
          a.playerName.localeCompare(b.playerName),
      )
      .slice(0, 5)
      .map(({ playCricketId, playerName, ownershipPct }) => ({
        playCricketId,
        playerName,
        ownershipPct,
      }));

    const mostCaptained = [...entries]
      .filter((e) => e.captainCount > 0)
      .sort(
        (a, b) =>
          b.captainCount - a.captainCount ||
          a.playerName.localeCompare(b.playerName),
      )
      .slice(0, 5)
      .map(({ playCricketId, playerName, captainPct }) => ({
        playCricketId,
        playerName,
        captainPct,
      }));

    // Build points map for differential ranking from current-season scores.
    const diffPointsMap = new Map<
      string,
      { playerName: string; points: number }
    >();
    let isFromPreviousSeason = false;

    const currentScores = await db
      .selectFrom("fantasy_player_score as fps")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "fps.play_cricket_id",
      )
      .where("fps.season", "=", s)
      .select([
        "fps.play_cricket_id",
        "fp.player_name",
        sql<string>`SUM(fps.total_points)`.as("total_points"),
      ])
      .groupBy(["fps.play_cricket_id", "fp.player_name"])
      .having(sql`SUM(fps.total_points)`, ">", 0)
      .execute();

    for (const row of currentScores) {
      diffPointsMap.set(row.play_cricket_id, {
        playerName: row.player_name,
        points: Number(row.total_points),
      });
    }

    // Fall back to previous season totals when the current season has no scores yet.
    if (diffPointsMap.size === 0) {
      isFromPreviousSeason = true;
      const prevSeason = getPreviousSeason(s);
      const prevScores = await db
        .selectFrom("fantasy_player_score as fps")
        .innerJoin(
          "fantasy_player as fp",
          "fp.play_cricket_id",
          "fps.play_cricket_id",
        )
        .where("fps.season", "=", prevSeason)
        .select([
          "fps.play_cricket_id",
          "fp.player_name",
          sql<string>`SUM(fps.total_points)`.as("total_points"),
        ])
        .groupBy(["fps.play_cricket_id", "fp.player_name"])
        .having(sql`SUM(fps.total_points)`, ">", 0)
        .execute();

      for (const row of prevScores) {
        diffPointsMap.set(row.play_cricket_id, {
          playerName: row.player_name,
          points: Number(row.total_points),
        });
      }

      // Final fall back to raw match performance data if fantasy_player_score is empty.
      if (diffPointsMap.size === 0) {
        const rawPoints = await calculateSeasonPointsFromMatches(db, [
          prevSeason,
        ]);
        for (const [playerId, pts] of rawPoints) {
          if (diffPointsMap.has(playerId)) continue;
          if (pts.totalPoints <= 0) continue;
          diffPointsMap.set(playerId, {
            playerName: nameMap.get(playerId) ?? "Unknown",
            points: pts.totalPoints,
          });
        }
      }
    }

    const differentials = rankDifferentials(
      ownershipMap,
      teamCount,
      diffPointsMap,
      5,
      costMap,
    );

    return {
      mostOwned,
      mostCaptained,
      differentials,
      teamCount,
      gameweek,
      isFromPreviousSeason,
    };
  };
}

export function getSandwichEfficiency(db: Kysely<DB>) {
  return async (season?: string, limit = 5) => {
    const s = season ?? getCurrentSeason();
    const preseason = isPreSeason(s);
    const effectiveSeason = preseason ? getPreviousSeason(s) : s;

    const players = await db
      .selectFrom("fantasy_player")
      .where("eligible", "=", true)
      .select(["play_cricket_id", "player_name", "sandwich_cost"])
      .execute();

    const playerMap = new Map(players.map((p) => [p.play_cricket_id, p]));

    // Try fantasy_player_score first
    const scoreRows = await db
      .selectFrom("fantasy_player_score")
      .where("season", "=", effectiveSeason)
      .groupBy("play_cricket_id")
      .select([
        "play_cricket_id",
        sql<string>`SUM(total_points)`.as("total_points"),
        sql<string>`COUNT(DISTINCT match_id)`.as("matches_played"),
      ])
      .having(sql`SUM(total_points)`, ">", 0)
      .execute();

    // Fall back to raw match performance data if fantasy_player_score is empty
    let pointsSource: Array<{
      play_cricket_id: string;
      total_points: number;
      matches_played: number;
    }>;

    if (scoreRows.length > 0) {
      pointsSource = scoreRows.map((r) => ({
        play_cricket_id: r.play_cricket_id,
        total_points: Number(r.total_points),
        matches_played: Number(r.matches_played),
      }));
    } else {
      const rawPoints = await calculateSeasonPointsFromMatches(db, [
        effectiveSeason,
      ]);
      pointsSource = Array.from(rawPoints.entries())
        .filter(([, pts]) => pts.totalPoints > 0)
        .map(([id, pts]) => ({
          play_cricket_id: id,
          total_points: pts.totalPoints,
          matches_played: pts.matchesPlayed,
        }));
    }

    const entries = pointsSource
      .filter((r) => playerMap.has(r.play_cricket_id))
      .map((r) => {
        const player = playerMap.get(r.play_cricket_id);
        if (!player) return null;
        const cost = player.sandwich_cost > 0 ? player.sandwich_cost : 1;
        return {
          playCricketId: r.play_cricket_id,
          playerName: player.player_name,
          sandwichCost: cost,
          totalPoints: r.total_points,
          matchesPlayed: r.matches_played,
          pointsPerSandwich: Math.round((r.total_points / cost) * 10) / 10,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => b.pointsPerSandwich - a.pointsPerSandwich);

    return {
      season: effectiveSeason,
      isFromPreviousSeason: preseason,
      entries: assignRanks(entries, (e) => e.pointsPerSandwich).slice(0, limit),
    };
  };
}

export function getGameweekHighlights(db: Kysely<DB>) {
  return async (season?: string, gameweek?: number) => {
    const s = season ?? getCurrentSeason();

    let targetGameweek = gameweek;
    if (targetGameweek === undefined) {
      const currentGw = getCurrentGameweek(s);
      const completedGw = Math.max(0, currentGw - 1);

      if (completedGw > 0) {
        const hasScores = await db
          .selectFrom("fantasy_team_score")
          .where("season", "=", s)
          .where("gameweek_id", "=", completedGw)
          .select("gameweek_id")
          .limit(1)
          .executeTakeFirst();

        if (hasScores) {
          targetGameweek = completedGw;
        }
      }

      if (targetGameweek === undefined) {
        const latestGw = await db
          .selectFrom("fantasy_team_score")
          .where("season", "=", s)
          .select(sql<string>`MAX(gameweek_id)`.as("max_gw"))
          .executeTakeFirst();
        targetGameweek = Number(latestGw?.max_gw ?? 0);
      }
    }

    if (targetGameweek === 0) {
      return { highlights: null, gameweek: 0, season: s };
    }

    // Top scorer
    const topScorerRows = await db
      .selectFrom("fantasy_player_score as fps")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "fps.play_cricket_id",
      )
      .where("fps.season", "=", s)
      .where("fps.gameweek_id", "=", targetGameweek)
      .select([
        "fps.play_cricket_id",
        "fp.player_name",
        sql<string>`SUM(fps.total_points)`.as("total_points"),
        sql<string>`SUM(fps.batting_points)`.as("batting_points"),
        sql<string>`SUM(fps.bowling_points)`.as("bowling_points"),
      ])
      .groupBy(["fps.play_cricket_id", "fp.player_name"])
      .orderBy(sql`SUM(fps.total_points)`, "desc")
      .limit(1)
      .execute();

    // Best spell
    const bestSpellRows = await db
      .selectFrom("fantasy_player_score as fps")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "fps.play_cricket_id",
      )
      .where("fps.season", "=", s)
      .where("fps.gameweek_id", "=", targetGameweek)
      .where("fps.bowling_points", ">", 0)
      .select([
        "fps.play_cricket_id",
        "fp.player_name",
        sql<string>`SUM(fps.bowling_points)`.as("bowling_points"),
        sql<string>`SUM(fps.total_points)`.as("total_points"),
      ])
      .groupBy(["fps.play_cricket_id", "fp.player_name"])
      .orderBy(sql`SUM(fps.bowling_points)`, "desc")
      .limit(1)
      .execute();

    // Ownership data
    const { ownershipMap, teamCount } = await getOwnershipData(
      db,
      s,
      targetGameweek,
    );

    // All player scores for this gameweek
    const allPlayerScores = await db
      .selectFrom("fantasy_player_score as fps")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "fps.play_cricket_id",
      )
      .where("fps.season", "=", s)
      .where("fps.gameweek_id", "=", targetGameweek)
      .select([
        "fps.play_cricket_id",
        "fp.player_name",
        sql<string>`SUM(fps.total_points)`.as("total_points"),
      ])
      .groupBy(["fps.play_cricket_id", "fp.player_name"])
      .orderBy(sql`SUM(fps.total_points)`, "desc")
      .execute();

    // Fantasy shock
    let fantasyShock: {
      playerName: string;
      playCricketId: string;
      totalPoints: number;
      ownershipPct: number;
    } | null = null;

    if (allPlayerScores.length > 0 && teamCount > 0) {
      const topPoints = Number(allPlayerScores[0]?.total_points ?? 0);
      const threshold = topPoints * 0.5;
      let bestShock: {
        playerName: string;
        playCricketId: string;
        totalPoints: number;
        ownershipPct: number;
        ownerCount: number;
      } | null = null;

      for (const ps of allPlayerScores) {
        if (Number(ps.total_points) < threshold) break;
        const ownership = ownershipMap.get(ps.play_cricket_id);
        const owners = ownership?.ownerCount ?? 0;
        if (
          !bestShock ||
          owners < bestShock.ownerCount ||
          (owners === bestShock.ownerCount &&
            Number(ps.total_points) > bestShock.totalPoints)
        ) {
          bestShock = {
            playerName: ps.player_name,
            playCricketId: ps.play_cricket_id,
            totalPoints: Number(ps.total_points),
            ownershipPct: ownership?.ownershipPct ?? 0,
            ownerCount: owners,
          };
        }
      }
      if (
        bestShock &&
        topScorerRows[0] &&
        bestShock.playCricketId !== topScorerRows[0].play_cricket_id
      ) {
        fantasyShock = {
          playerName: bestShock.playerName,
          playCricketId: bestShock.playCricketId,
          totalPoints: bestShock.totalPoints,
          ownershipPct: bestShock.ownershipPct,
        };
      }
    }

    // Most captained
    let mostCaptained: {
      playerName: string;
      playCricketId: string;
      captainPct: number;
    } | null = null;
    if (teamCount > 0) {
      let bestCaptainId: string | null = null;
      let bestCaptainCount = 0;
      let bestCaptainPct = 0;
      for (const [id, entry] of ownershipMap) {
        if (entry.captainCount > bestCaptainCount) {
          bestCaptainId = id;
          bestCaptainCount = entry.captainCount;
          bestCaptainPct = entry.captainPct;
        }
      }
      if (bestCaptainId && bestCaptainCount > 0) {
        const captainPlayer = await db
          .selectFrom("fantasy_player")
          .where("play_cricket_id", "=", bestCaptainId)
          .select("player_name")
          .executeTakeFirst();
        if (captainPlayer) {
          mostCaptained = {
            playerName: captainPlayer.player_name,
            playCricketId: bestCaptainId,
            captainPct: bestCaptainPct,
          };
        }
      }
    }

    // Differential pick
    let differentialPick: {
      playerName: string;
      playCricketId: string;
      totalPoints: number;
      ownershipPct: number;
    } | null = null;
    if (allPlayerScores.length > 0 && teamCount > 0) {
      const gwPointsMap = new Map<
        string,
        { playerName: string; points: number }
      >();
      for (const ps of allPlayerScores) {
        gwPointsMap.set(ps.play_cricket_id, {
          playerName: ps.player_name,
          points: Number(ps.total_points),
        });
      }
      const topDiff = rankDifferentials(
        ownershipMap,
        teamCount,
        gwPointsMap,
        1,
      );
      if (topDiff[0]) {
        differentialPick = {
          playerName: topDiff[0].playerName,
          playCricketId: topDiff[0].playCricketId,
          totalPoints: topDiff[0].points,
          ownershipPct: topDiff[0].ownershipPct,
        };
      }
    }

    // Top team
    const topTeamRow = await db
      .selectFrom("fantasy_team_score as fts")
      .innerJoin("fantasy_team as ft", "ft.id", "fts.fantasy_team_id")
      .innerJoin("user as u", "u.id", "ft.user_id")
      .where("fts.season", "=", s)
      .where("fts.gameweek_id", "=", targetGameweek)
      .select([
        "fts.fantasy_team_id",
        "fts.total_points",
        "u.name as ownerName",
      ])
      .orderBy("fts.total_points", "desc")
      .limit(1)
      .executeTakeFirst();

    // Biggest mover
    let biggestMover: {
      ownerName: string;
      teamId: number;
      rankChange: number;
      currentRank: number;
      previousRank: number;
    } | null = null;

    if (targetGameweek > 1) {
      const currentCumulative = await db
        .selectFrom("fantasy_team_score as fts")
        .innerJoin("fantasy_team as ft", "ft.id", "fts.fantasy_team_id")
        .innerJoin("user as u", "u.id", "ft.user_id")
        .where("fts.season", "=", s)
        .where("fts.gameweek_id", "<=", targetGameweek)
        .select([
          "fts.fantasy_team_id",
          sql<string>`SUM(fts.total_points)`.as("cumulative_points"),
          "u.name as ownerName",
        ])
        .groupBy(["fts.fantasy_team_id", "ft.user_id", "u.name"])
        .orderBy(sql`SUM(fts.total_points)`, "desc")
        .execute();

      const previousCumulative = await db
        .selectFrom("fantasy_team_score as fts")
        .innerJoin("fantasy_team as ft", "ft.id", "fts.fantasy_team_id")
        .where("fts.season", "=", s)
        .where("fts.gameweek_id", "<=", targetGameweek - 1)
        .select([
          "fts.fantasy_team_id",
          sql<string>`SUM(fts.total_points)`.as("cumulative_points"),
        ])
        .groupBy("fts.fantasy_team_id")
        .orderBy(sql`SUM(fts.total_points)`, "desc")
        .execute();

      const currentRanked = assignRanks(
        currentCumulative.map((e) => ({
          teamId: e.fantasy_team_id,
          ownerName: e.ownerName,
          points: Number(e.cumulative_points),
        })),
        (e) => e.points,
      );

      const previousRanked = assignRanks(
        previousCumulative.map((e) => ({
          teamId: e.fantasy_team_id,
          points: Number(e.cumulative_points),
        })),
        (e) => e.points,
      );

      const prevRankMap = new Map<number, number>();
      for (const entry of previousRanked) {
        prevRankMap.set(entry.teamId, entry.rank);
      }

      let bestChange = 0;
      for (const entry of currentRanked) {
        const prevRank = prevRankMap.get(entry.teamId);
        if (prevRank !== undefined) {
          const change = prevRank - entry.rank;
          if (change > bestChange) {
            bestChange = change;
            biggestMover = {
              ownerName: entry.ownerName,
              teamId: entry.teamId,
              rankChange: change,
              currentRank: entry.rank,
              previousRank: prevRank,
            };
          }
        }
      }
    }

    return {
      highlights: {
        topScorer: topScorerRows[0]
          ? {
              playerName: topScorerRows[0].player_name,
              playCricketId: topScorerRows[0].play_cricket_id,
              totalPoints: Number(topScorerRows[0].total_points),
            }
          : null,
        bestSpell: bestSpellRows[0]
          ? {
              playerName: bestSpellRows[0].player_name,
              playCricketId: bestSpellRows[0].play_cricket_id,
              bowlingPoints: Number(bestSpellRows[0].bowling_points),
              totalPoints: Number(bestSpellRows[0].total_points),
            }
          : null,
        fantasyShock,
        topTeam: topTeamRow
          ? {
              teamId: topTeamRow.fantasy_team_id,
              ownerName: topTeamRow.ownerName,
              totalPoints: topTeamRow.total_points,
            }
          : null,
        biggestMover,
        mostCaptained,
        differentialPick,
        teamCount,
      },
      gameweek: targetGameweek,
      season: s,
    };
  };
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export function getSeasonLeaderboard(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();

    const entries = await db
      .selectFrom("fantasy_team_score as fts")
      .innerJoin("fantasy_team as ft", "ft.id", "fts.fantasy_team_id")
      .innerJoin("user as u", "u.id", "ft.user_id")
      .where("fts.season", "=", s)
      .select([
        "fts.fantasy_team_id",
        sql<string>`SUM(fts.total_points)`.as("total_points"),
        sql<string>`COUNT(DISTINCT fts.gameweek_id)`.as("gameweeks_played"),
        "u.name as ownerName",
      ])
      .groupBy(["fts.fantasy_team_id", "ft.user_id", "u.name"])
      .orderBy(sql`SUM(fts.total_points)`, "desc")
      .execute();

    const ranked = assignRanks(
      entries.map((e) => ({
        teamId: e.fantasy_team_id,
        ownerName: e.ownerName,
        totalPoints: Number(e.total_points),
        gameweeksPlayed: Number(e.gameweeks_played),
      })),
      (e) => e.totalPoints,
    );

    return { entries: ranked, season: s };
  };
}

export function getWeeklyLeaderboard(db: Kysely<DB>) {
  return async (season?: string, gameweek?: number) => {
    const s = season ?? getCurrentSeason();

    let targetGameweek = gameweek;
    if (targetGameweek === undefined) {
      const currentGw = getCurrentGameweek(s);
      const completedGw = Math.max(0, currentGw - 1);

      if (completedGw > 0) {
        const hasScores = await db
          .selectFrom("fantasy_team_score")
          .where("season", "=", s)
          .where("gameweek_id", "=", completedGw)
          .select("gameweek_id")
          .limit(1)
          .executeTakeFirst();

        if (hasScores) {
          targetGameweek = completedGw;
        }
      }

      if (targetGameweek === undefined) {
        const latestGw = await db
          .selectFrom("fantasy_team_score")
          .where("season", "=", s)
          .select(sql<string>`MAX(gameweek_id)`.as("max_gw"))
          .executeTakeFirst();
        targetGameweek = Number(latestGw?.max_gw ?? 0);
      }
    }

    if (targetGameweek === 0) {
      return {
        entries: [],
        gameweek: 0,
        season: s,
        availableGameweeks: [],
      };
    }

    const gws = await db
      .selectFrom("fantasy_team_score")
      .where("season", "=", s)
      .select("gameweek_id")
      .distinct()
      .orderBy("gameweek_id", "desc")
      .execute();

    const availableGameweeks = gws.map((r) => r.gameweek_id);

    const entries = await db
      .selectFrom("fantasy_team_score as fts")
      .innerJoin("fantasy_team as ft", "ft.id", "fts.fantasy_team_id")
      .innerJoin("user as u", "u.id", "ft.user_id")
      .where("fts.gameweek_id", "=", targetGameweek)
      .where("fts.season", "=", s)
      .select([
        "fts.fantasy_team_id",
        "fts.total_points",
        "u.name as ownerName",
      ])
      .orderBy("fts.total_points", "desc")
      .execute();

    const ranked = assignRanks(
      entries.map((e) => ({
        teamId: e.fantasy_team_id,
        ownerName: e.ownerName,
        weeklyPoints: e.total_points,
      })),
      (e) => e.weeklyPoints,
    );

    return {
      entries: ranked,
      gameweek: targetGameweek,
      season: s,
      availableGameweeks,
    };
  };
}

export function getPlayerLeaderboard(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();

    const entries = await db
      .selectFrom("fantasy_player_score as fps")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "fps.play_cricket_id",
      )
      .where("fps.season", "=", s)
      .where("fp.eligible", "=", true)
      .select([
        "fps.play_cricket_id",
        "fp.player_name",
        sql<string>`SUM(fps.batting_points)`.as("batting_points"),
        sql<string>`SUM(fps.bowling_points)`.as("bowling_points"),
        sql<string>`SUM(fps.fielding_points)`.as("fielding_points"),
        sql<string>`SUM(fps.team_points)`.as("team_points"),
        sql<string>`SUM(fps.total_points)`.as("total_points"),
        sql<string>`COUNT(DISTINCT fps.match_id)`.as("matches_played"),
      ])
      .groupBy(["fps.play_cricket_id", "fp.player_name"])
      .orderBy(sql`SUM(fps.total_points)`, "desc")
      .execute();

    const ranked = assignRanks(
      entries.map((e) => ({
        playCricketId: e.play_cricket_id,
        playerName: e.player_name,
        battingPoints: Number(e.batting_points),
        bowlingPoints: Number(e.bowling_points),
        fieldingPoints: Number(e.fielding_points),
        teamPoints: Number(e.team_points),
        totalPoints: Number(e.total_points),
        matchesPlayed: Number(e.matches_played),
      })),
      (e) => e.totalPoints,
    );

    return { entries: ranked, season: s };
  };
}

// ---------------------------------------------------------------------------
// Team browsing
// ---------------------------------------------------------------------------

export function listTeams(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();

    const teams = await db
      .selectFrom("fantasy_team as ft")
      .innerJoin("user as u", "u.id", "ft.user_id")
      .where("ft.season", "=", s)
      .select([
        "ft.id",
        "ft.season",
        "ft.created_at",
        "u.name as ownerName",
        "u.id as ownerId",
      ])
      .orderBy("ft.created_at", "asc")
      .execute();

    return {
      teams: teams.map((t) => ({
        id: t.id,
        season: t.season,
        ownerName: t.ownerName,
        ownerId: t.ownerId,
        createdAt: t.created_at,
      })),
      season: s,
    };
  };
}

export function getTeam(db: Kysely<DB>) {
  return async (teamId: number) => {
    const team = await db
      .selectFrom("fantasy_team as ft")
      .innerJoin("user as u", "u.id", "ft.user_id")
      .where("ft.id", "=", teamId)
      .select([
        "ft.id",
        "ft.season",
        "ft.created_at",
        "u.name as ownerName",
        "u.id as ownerId",
      ])
      .executeTakeFirst();

    if (!team) {
      throw httpError(404, "Team not found.");
    }

    const currentGameweek = getCurrentGameweek(team.season);

    const players = await db
      .selectFrom("fantasy_team_player as ftp")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "ftp.play_cricket_id",
      )
      .where("ftp.fantasy_team_id", "=", team.id)
      .where("ftp.gameweek_added", "<=", currentGameweek)
      .where((eb) =>
        eb.or([
          eb("ftp.gameweek_removed", "is", null),
          eb("ftp.gameweek_removed", ">", currentGameweek),
        ]),
      )
      .select([
        "ftp.play_cricket_id",
        "fp.player_name",
        "fp.sandwich_cost",
        "ftp.is_captain",
        "ftp.slot_type",
        "ftp.is_wicketkeeper",
      ])
      .execute();

    const { ownershipMap } = await getOwnershipData(
      db,
      team.season,
      currentGameweek,
    );

    // Team-level weekly scores across the season.
    const teamScores = await db
      .selectFrom("fantasy_team_score")
      .where("fantasy_team_id", "=", team.id)
      .where("season", "=", team.season)
      .select(["gameweek_id", "total_points"])
      .orderBy("gameweek_id", "asc")
      .execute();

    const seasonPoints = teamScores.reduce((sum, s) => sum + s.total_points, 0);
    const gameweeksPlayed = teamScores.length;
    const latestGameweek =
      teamScores.length > 0
        ? (teamScores[teamScores.length - 1]?.gameweek_id ?? null)
        : null;
    const latestGameweekPoints =
      teamScores.length > 0
        ? (teamScores[teamScores.length - 1]?.total_points ?? 0)
        : 0;

    // Compute per-player effective points across the season for this team.
    const effectivePointsBy = await computeTeamEffectivePoints(
      db,
      team.id,
      team.season,
      teamScores.map((ts) => ts.gameweek_id),
    );

    return {
      team: {
        id: team.id,
        season: team.season,
        ownerName: team.ownerName,
        ownerId: team.ownerId,
        seasonPoints,
        latestGameweek,
        latestGameweekPoints,
        gameweeksPlayed,
      },
      players: players.map((p) => {
        const ownership = ownershipMap.get(p.play_cricket_id);
        const eff = effectivePointsBy.get(p.play_cricket_id);
        return {
          playCricketId: p.play_cricket_id,
          playerName: p.player_name,
          sandwichCost: p.sandwich_cost,
          isCaptain: p.is_captain,
          slotType: p.slot_type as SlotType,
          isWicketkeeper: p.is_wicketkeeper,
          ownershipPct: ownership?.ownershipPct ?? 0,
          seasonPoints: eff?.seasonPoints ?? 0,
          latestGameweekPoints: eff?.latestGameweekPoints ?? 0,
        };
      }),
    };
  };
}

/**
 * Load all squad memberships, player scores, and chip usages for this team,
 * then compute per-player effective points (accounting for captain multiplier,
 * slot/WK rules, triple-captain chip) for each gameweek in `gameweeks`, and
 * return a per-player aggregate of season total and latest-gameweek totals.
 */
async function computeTeamEffectivePoints(
  db: Kysely<DB>,
  teamId: number,
  season: string,
  gameweeks: number[],
): Promise<
  Map<string, { seasonPoints: number; latestGameweekPoints: number }>
> {
  if (gameweeks.length === 0) return new Map();

  const latestGameweek = gameweeks[gameweeks.length - 1] ?? null;

  const memberships = await db
    .selectFrom("fantasy_team_player")
    .where("fantasy_team_id", "=", teamId)
    .select([
      "play_cricket_id",
      "gameweek_added",
      "gameweek_removed",
      "is_captain",
      "slot_type",
      "is_wicketkeeper",
    ])
    .execute();

  if (memberships.length === 0) return new Map();

  const playerIds = Array.from(
    new Set(memberships.map((m) => m.play_cricket_id)),
  );

  const scores = await db
    .selectFrom("fantasy_player_score")
    .where("season", "=", season)
    .where("gameweek_id", "in", gameweeks)
    .where("play_cricket_id", "in", playerIds)
    .select([
      "play_cricket_id",
      "gameweek_id",
      "batting_points",
      "bowling_points",
      "fielding_points",
      "team_points",
      "catches",
      "stumpings",
      "is_actual_keeper",
    ])
    .execute();

  const chipRows = await db
    .selectFrom("fantasy_chip_usage")
    .where("fantasy_team_id", "=", teamId)
    .where("season", "=", season)
    .select(["gameweek_id", "chip_type"])
    .execute();

  const tripleCaptainGameweeks = new Set(
    chipRows
      .filter((c) => c.chip_type === "triple_captain")
      .map((c) => c.gameweek_id),
  );

  // Group aggregated scores: (playerId, gameweek) -> summed score components.
  interface GwScore {
    battingPoints: number;
    bowlingPoints: number;
    fieldingPoints: number;
    teamPoints: number;
    catches: number;
    stumpings: number;
    isActualKeeper: boolean;
  }
  const scoresByPlayerGw = new Map<string, GwScore>();
  const key = (playerId: string, gw: number) => `${playerId}::${gw}`;
  for (const s of scores) {
    const k = key(s.play_cricket_id, s.gameweek_id);
    const existing = scoresByPlayerGw.get(k) ?? {
      battingPoints: 0,
      bowlingPoints: 0,
      fieldingPoints: 0,
      teamPoints: 0,
      catches: 0,
      stumpings: 0,
      isActualKeeper: false,
    };
    existing.battingPoints += s.batting_points;
    existing.bowlingPoints += s.bowling_points;
    existing.fieldingPoints += s.fielding_points;
    existing.teamPoints += s.team_points;
    existing.catches += s.catches;
    existing.stumpings += s.stumpings;
    if (s.is_actual_keeper) existing.isActualKeeper = true;
    scoresByPlayerGw.set(k, existing);
  }

  const result = new Map<
    string,
    { seasonPoints: number; latestGameweekPoints: number }
  >();

  for (const m of memberships) {
    for (const gw of gameweeks) {
      // Player only counts if in squad that gameweek.
      if (m.gameweek_added > gw) continue;
      if (m.gameweek_removed !== null && m.gameweek_removed <= gw) continue;

      const s = scoresByPlayerGw.get(key(m.play_cricket_id, gw));
      if (!s) continue;

      const captainMultiplier = tripleCaptainGameweeks.has(gw)
        ? CHIPS.triple_captain.captainMultiplier
        : 2;

      const effective = calculateSlotEffectivePoints({
        slotType: m.slot_type as SlotType,
        isFantasyWk: m.is_wicketkeeper,
        battingPts: s.battingPoints,
        bowlingPts: s.bowlingPoints,
        fieldingPts: s.fieldingPoints,
        teamPts: s.teamPoints,
        catches: s.catches,
        stumpings: s.stumpings,
        isActualKeeper: s.isActualKeeper,
        isCaptain: m.is_captain,
        captainMultiplier,
      });

      const existing = result.get(m.play_cricket_id) ?? {
        seasonPoints: 0,
        latestGameweekPoints: 0,
      };
      existing.seasonPoints += effective;
      if (gw === latestGameweek) {
        existing.latestGameweekPoints += effective;
      }
      result.set(m.play_cricket_id, existing);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// History & detailed views
// ---------------------------------------------------------------------------

export function getGameweekDetail(db: Kysely<DB>) {
  return async (teamId: number, gameweek: number, season?: string) => {
    const s = season ?? getCurrentSeason();

    const team = await db
      .selectFrom("fantasy_team as ft")
      .innerJoin("user as u", "u.id", "ft.user_id")
      .where("ft.id", "=", teamId)
      .select(["ft.id", "ft.season", "u.name as ownerName"])
      .executeTakeFirst();

    if (!team) {
      throw httpError(404, "Team not found.");
    }

    const teamScore = await db
      .selectFrom("fantasy_team_score")
      .where("fantasy_team_id", "=", teamId)
      .where("gameweek_id", "=", gameweek)
      .where("season", "=", s)
      .select("total_points")
      .executeTakeFirst();

    const players = await db
      .selectFrom("fantasy_team_player as ftp")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "ftp.play_cricket_id",
      )
      .where("ftp.fantasy_team_id", "=", teamId)
      .where("ftp.gameweek_added", "<=", gameweek)
      .where((eb) =>
        eb.or([
          eb("ftp.gameweek_removed", "is", null),
          eb("ftp.gameweek_removed", ">", gameweek),
        ]),
      )
      .select([
        "ftp.play_cricket_id",
        "fp.player_name",
        "ftp.is_captain",
        "ftp.slot_type",
        "ftp.is_wicketkeeper",
      ])
      .execute();

    const playerScores = await db
      .selectFrom("fantasy_player_score")
      .where("season", "=", s)
      .where("gameweek_id", "=", gameweek)
      .where(
        "play_cricket_id",
        "in",
        players.map((p) => p.play_cricket_id),
      )
      .select([
        "play_cricket_id",
        "batting_points",
        "bowling_points",
        "fielding_points",
        "team_points",
        "total_points",
        "match_id",
        "catches",
        "stumpings",
        "is_actual_keeper",
      ])
      .execute();

    // Group scores by player
    const scoresByPlayer = new Map<
      string,
      {
        battingPoints: number;
        bowlingPoints: number;
        fieldingPoints: number;
        teamPoints: number;
        totalPoints: number;
        matchCount: number;
        catches: number;
        stumpings: number;
        isActualKeeper: boolean;
      }
    >();

    for (const score of playerScores) {
      const existing = scoresByPlayer.get(score.play_cricket_id) ?? {
        battingPoints: 0,
        bowlingPoints: 0,
        fieldingPoints: 0,
        teamPoints: 0,
        totalPoints: 0,
        matchCount: 0,
        catches: 0,
        stumpings: 0,
        isActualKeeper: false,
      };
      existing.battingPoints += score.batting_points;
      existing.bowlingPoints += score.bowling_points;
      existing.fieldingPoints += score.fielding_points;
      existing.teamPoints += score.team_points;
      existing.totalPoints += score.total_points;
      existing.matchCount += 1;
      existing.catches += score.catches;
      existing.stumpings += score.stumpings;
      if (score.is_actual_keeper) existing.isActualKeeper = true;
      scoresByPlayer.set(score.play_cricket_id, existing);
    }

    // Check for active chips
    const activeChips = await db
      .selectFrom("fantasy_chip_usage")
      .where("fantasy_team_id", "=", teamId)
      .where("gameweek_id", "=", gameweek)
      .where("season", "=", s)
      .select("chip_type")
      .execute();

    const activeChipTypes = activeChips.map((c) => c.chip_type);
    const hasTripleCaptain = activeChipTypes.includes("triple_captain");
    const captainMultiplier = hasTripleCaptain
      ? CHIPS.triple_captain.captainMultiplier
      : 2;

    return {
      team: {
        id: team.id,
        ownerName: team.ownerName,
        totalPoints: teamScore?.total_points ?? 0,
      },
      gameweek,
      season: s,
      activeChips: activeChipTypes,
      players: players.map((p) => {
        const scores = scoresByPlayer.get(p.play_cricket_id);
        const isCaptain = p.is_captain;
        const slotType = (p.slot_type ?? "batting") as SlotType;
        const isWicketkeeper = p.is_wicketkeeper;

        const effectivePoints = scores
          ? calculateSlotEffectivePoints({
              slotType,
              isFantasyWk: isWicketkeeper,
              battingPts: scores.battingPoints,
              bowlingPts: scores.bowlingPoints,
              fieldingPts: scores.fieldingPoints,
              teamPts: scores.teamPoints,
              catches: scores.catches,
              stumpings: scores.stumpings,
              isActualKeeper: scores.isActualKeeper,
              isCaptain,
              captainMultiplier,
            })
          : 0;

        return {
          playCricketId: p.play_cricket_id,
          playerName: p.player_name,
          isCaptain,
          slotType,
          isWicketkeeper,
          battingPoints: scores?.battingPoints ?? 0,
          bowlingPoints: scores?.bowlingPoints ?? 0,
          fieldingPoints: scores?.fieldingPoints ?? 0,
          teamPoints: scores?.teamPoints ?? 0,
          basePoints:
            isCaptain && effectivePoints > 0
              ? Math.round(effectivePoints / captainMultiplier)
              : effectivePoints,
          effectivePoints,
          captainMultiplier: isCaptain ? captainMultiplier : 1,
          matchCount: scores?.matchCount ?? 0,
        };
      }),
    };
  };
}

export function getPlayerHistory(db: Kysely<DB>) {
  return async (playCricketId: string, season?: string) => {
    const s = season ?? getCurrentSeason();

    const player = await db
      .selectFrom("fantasy_player")
      .where("play_cricket_id", "=", playCricketId)
      .select("player_name")
      .executeTakeFirst();

    if (!player) {
      throw httpError(404, "Player not found.");
    }

    const scores = await db
      .selectFrom("fantasy_player_score")
      .where("play_cricket_id", "=", playCricketId)
      .where("season", "=", s)
      .select([
        "gameweek_id",
        "match_id",
        "batting_points",
        "bowling_points",
        "fielding_points",
        "team_points",
        "total_points",
      ])
      .orderBy("gameweek_id", "asc")
      .execute();

    // Group by gameweek
    const byGameweek = new Map<
      number,
      {
        battingPoints: number;
        bowlingPoints: number;
        fieldingPoints: number;
        teamPoints: number;
        totalPoints: number;
        matchCount: number;
      }
    >();

    for (const sc of scores) {
      const existing = byGameweek.get(sc.gameweek_id) ?? {
        battingPoints: 0,
        bowlingPoints: 0,
        fieldingPoints: 0,
        teamPoints: 0,
        totalPoints: 0,
        matchCount: 0,
      };
      existing.battingPoints += sc.batting_points;
      existing.bowlingPoints += sc.bowling_points;
      existing.fieldingPoints += sc.fielding_points;
      existing.teamPoints += sc.team_points;
      existing.totalPoints += sc.total_points;
      existing.matchCount += 1;
      byGameweek.set(sc.gameweek_id, existing);
    }

    const gameweeks = Array.from(byGameweek.entries())
      .sort(([a], [b]) => a - b)
      .map(([gw, data]) => ({ gameweek: gw, ...data }));

    return {
      playerName: player.player_name,
      playCricketId,
      season: s,
      gameweeks,
    };
  };
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function getChipStatus(db: Kysely<DB>) {
  return async (userId: string, season?: string) => {
    const s = season ?? getCurrentSeason();
    const gameweek = getCurrentGameweek(s);

    const team = await db
      .selectFrom("fantasy_team")
      .where("user_id", "=", userId)
      .where("season", "=", s)
      .select("id")
      .executeTakeFirst();

    if (!team) {
      return {
        chips: CHIP_TYPES.map((type) => ({
          chipType: type,
          usedThisSeason: 0,
          maxPerSeason: CHIPS[type].usesPerSeason,
          activeThisGameweek: false,
        })),
        gameweek,
      };
    }

    const usages = await db
      .selectFrom("fantasy_chip_usage")
      .where("fantasy_team_id", "=", team.id)
      .where("season", "=", s)
      .select(["chip_type", "gameweek_id"])
      .execute();

    const chipStatus = CHIP_TYPES.map((type) => {
      const usedCount = usages.filter((u) => u.chip_type === type).length;
      const activeThisGw = usages.some(
        (u) => u.chip_type === type && u.gameweek_id === gameweek,
      );
      return {
        chipType: type,
        usedThisSeason: usedCount,
        maxPerSeason: CHIPS[type].usesPerSeason,
        activeThisGameweek: activeThisGw,
      };
    });

    return { chips: chipStatus, gameweek };
  };
}

export function activateChip(db: Kysely<DB>) {
  return async (userId: string, chipType: ChipType, season?: string) => {
    const s = season ?? getCurrentSeason();

    if (isGameweekLocked(s)) {
      throw httpError(400, "Cannot activate chips during locked weekends.");
    }

    const gameweek = getCurrentGameweek(s);
    if (gameweek === 0) {
      throw httpError(400, "Cannot activate chips during pre-season.");
    }

    const team = await db
      .selectFrom("fantasy_team")
      .where("user_id", "=", userId)
      .where("season", "=", s)
      .select("id")
      .executeTakeFirst();

    if (!team) {
      throw httpError(400, "You need a team before activating a chip.");
    }

    const chipConfig = CHIPS[chipType];

    const usedThisSeason = await db
      .selectFrom("fantasy_chip_usage")
      .where("fantasy_team_id", "=", team.id)
      .where("chip_type", "=", chipType)
      .where("season", "=", s)
      .select(sql<string>`COUNT(*)`.as("count"))
      .executeTakeFirst();

    if (Number(usedThisSeason?.count ?? 0) >= chipConfig.usesPerSeason) {
      throw httpError(
        400,
        `You have already used all ${chipConfig.usesPerSeason} ${chipType.replace("_", " ")} chips this season.`,
      );
    }

    // Check if already active this gameweek
    const alreadyActive = await db
      .selectFrom("fantasy_chip_usage")
      .where("fantasy_team_id", "=", team.id)
      .where("chip_type", "=", chipType)
      .where("gameweek_id", "=", gameweek)
      .where("season", "=", s)
      .select("fantasy_team_id")
      .executeTakeFirst();

    if (alreadyActive) {
      throw httpError(
        400,
        `${chipType.replace("_", " ")} chip is already active for this gameweek.`,
      );
    }

    await db
      .insertInto("fantasy_chip_usage")
      .values({
        fantasy_team_id: team.id,
        chip_type: chipType,
        gameweek_id: gameweek,
        season: s,
      })
      .execute();

    return { success: true };
  };
}

export function deactivateChip(db: Kysely<DB>) {
  return async (userId: string, chipType: ChipType, season?: string) => {
    const s = season ?? getCurrentSeason();
    const gameweek = getCurrentGameweek(s);

    if (gameweek === 0) {
      throw httpError(400, "Cannot deactivate chips during pre-season.");
    }

    if (isGameweekLocked(s)) {
      throw httpError(400, "Cannot deactivate chips during locked weekends.");
    }

    const team = await db
      .selectFrom("fantasy_team")
      .where("user_id", "=", userId)
      .where("season", "=", s)
      .select("id")
      .executeTakeFirst();

    if (!team) {
      throw httpError(400, "Team not found.");
    }

    const deleted = await db
      .deleteFrom("fantasy_chip_usage")
      .where("fantasy_team_id", "=", team.id)
      .where("chip_type", "=", chipType)
      .where("gameweek_id", "=", gameweek)
      .where("season", "=", s)
      .execute();

    if (Number(deleted[0]?.numDeletedRows ?? 0) === 0) {
      throw httpError(400, "No active chip found for this gameweek.");
    }

    return { success: true };
  };
}

// ---------------------------------------------------------------------------
// Admin: Chaos weeks
// ---------------------------------------------------------------------------

export function listChaosWeeks(db: Kysely<DB>) {
  return async (season?: string) => {
    const s = season ?? getCurrentSeason();
    const weeks = await db
      .selectFrom("fantasy_chaos_week")
      .where("season", "=", s)
      .orderBy("gameweek_id", "asc")
      .selectAll()
      .execute();
    return { weeks, season: s };
  };
}

export function createChaosWeek(db: Kysely<DB>) {
  return async (params: {
    season?: string;
    gameweekId: number;
    name: string;
    description: string;
    ruleType: string;
    ruleConfig?: string;
  }) => {
    const s = params.season ?? getCurrentSeason();

    if (params.ruleConfig) {
      try {
        JSON.parse(params.ruleConfig);
      } catch {
        throw httpError(400, "Rule config must be valid JSON.");
      }
    }

    const existing = await db
      .selectFrom("fantasy_chaos_week")
      .where("season", "=", s)
      .where("gameweek_id", "=", params.gameweekId)
      .select("id")
      .executeTakeFirst();

    if (existing) {
      throw httpError(
        409,
        `A chaos week already exists for gameweek ${params.gameweekId}.`,
      );
    }

    const result = await db
      .insertInto("fantasy_chaos_week")
      .values({
        season: s,
        gameweek_id: params.gameweekId,
        name: params.name,
        description: params.description,
        rule_type: params.ruleType,
        rule_config: params.ruleConfig ?? "{}",
        send_email: true,
        email_sent: false,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return { id: result.id, season: s, gameweekId: params.gameweekId };
  };
}

export function deleteChaosWeek(db: Kysely<DB>) {
  return async (id: number) => {
    await db.deleteFrom("fantasy_chaos_week").where("id", "=", id).execute();
    return { success: true };
  };
}

// ---------------------------------------------------------------------------
// Team share image data
// ---------------------------------------------------------------------------

export function getTeamShareData(db: Kysely<DB>) {
  return async (userId: string, season?: string) => {
    const s = season ?? getCurrentSeason();
    const gameweek = getCurrentGameweek(s);

    const team = await db
      .selectFrom("fantasy_team as ft")
      .innerJoin("user as u", "u.id", "ft.user_id")
      .where("ft.user_id", "=", userId)
      .where("ft.season", "=", s)
      .select(["ft.id", "ft.season", "u.name as ownerName"])
      .executeTakeFirst();

    if (!team) return null;

    // Build gameweek label
    let gameweekLabel: string;
    if (gameweek === 0) {
      gameweekLabel = "Pre-Season";
    } else {
      const gw1 = getGW1StartDate(s);
      const gwStartMs =
        gw1.getTime() + (gameweek - 1) * 7 * 24 * 60 * 60 * 1000;
      const gwStart = new Date(gwStartMs);
      const dateStr = gwStart.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      gameweekLabel = `Gameweek ${gameweek}: ${dateStr}`;
    }

    const players = await db
      .selectFrom("fantasy_team_player as ftp")
      .innerJoin(
        "fantasy_player as fp",
        "fp.play_cricket_id",
        "ftp.play_cricket_id",
      )
      .where("ftp.fantasy_team_id", "=", team.id)
      .where("ftp.gameweek_added", "<=", gameweek)
      .where((eb) =>
        eb.or([
          eb("ftp.gameweek_removed", "is", null),
          eb("ftp.gameweek_removed", ">", gameweek),
        ]),
      )
      .select([
        "ftp.play_cricket_id",
        "fp.player_name",
        "fp.sandwich_cost",
        "ftp.is_captain",
        "ftp.slot_type",
        "ftp.is_wicketkeeper",
      ])
      .execute();

    const totalSandwichCost = players.reduce(
      (sum, p) => sum + p.sandwich_cost,
      0,
    );

    return {
      ownerName: team.ownerName,
      season: team.season,
      totalSandwichCost,
      gameweekLabel,
      players: players.map((p) => ({
        playerName: p.player_name,
        sandwichCost: p.sandwich_cost,
        isCaptain: p.is_captain,
        slotType: p.slot_type as SlotType,
        isWicketkeeper: p.is_wicketkeeper,
      })),
    };
  };
}
