import type { DB } from "@percy-main/db";
import { type Kysely, sql } from "kysely";
import type { CricketLeaderboardQuery } from "./schemas.js";

/**
 * Get aggregated batting stats for a season, grouped by player.
 */
export function listBattingLeaderboard(db: Kysely<DB>) {
  return async (params: CricketLeaderboardQuery) => {
    let query = db
      .selectFrom("match_performance_batting as b")
      .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
      .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
      .where("b.season", "=", params.season)
      .groupBy(["b.player_id", "b.player_name", "m.contentful_entry_id"])
      .select([
        "b.player_id as playerId",
        "b.player_name as playerName",
        "m.contentful_entry_id as contentfulEntryId",
      ])
      .select((eb) => [
        eb.fn.countAll().as("innings"),
        eb.fn.sum<string>("b.runs").as("totalRuns"),
        eb.fn
          .sum<string>(
            sql<number>`CASE WHEN ${eb.ref("b.not_out")} THEN 1 ELSE 0 END`,
          )
          .as("notOuts"),
        eb.fn.max("b.runs").as("highScore"),
        eb.fn.sum<string>("b.balls").as("totalBalls"),
        eb.fn.sum<string>("b.fours").as("totalFours"),
        eb.fn.sum<string>("b.sixes").as("totalSixes"),
        eb.fn
          .sum<string>(
            sql<number>`CASE WHEN ${eb.ref("b.runs")} >= 50 AND ${eb.ref("b.runs")} < 100 THEN 1 ELSE 0 END`,
          )
          .as("fifties"),
        eb.fn
          .sum<string>(
            sql<number>`CASE WHEN ${eb.ref("b.runs")} >= 100 THEN 1 ELSE 0 END`,
          )
          .as("hundreds"),
      ])
      .orderBy(sql`SUM(b.runs)`, "desc")
      .limit(params.limit);

    if (params.isJunior !== undefined) {
      query = query.where("t.is_junior", "=", params.isJunior);
    }

    if (params.teamId) {
      query = query.where("b.team_id", "=", params.teamId);
    }

    if (params.competitionTypes) {
      const types = params.competitionTypes
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length > 0) {
        query = query.where("b.competition_type", "in", types);
      }
    }

    const rows = await query.execute();

    return {
      entries: rows.map((row) => {
        const innings = Number(row.innings);
        const notOuts = Number(row.notOuts);
        const runs = Number(row.totalRuns);
        const totalBalls = Number(row.totalBalls);
        const dismissals = innings - notOuts;

        return {
          playerId: row.playerId,
          playerName: row.playerName,
          contentfulEntryId: row.contentfulEntryId,
          innings,
          notOuts,
          runs,
          highScore: Number(row.highScore),
          average:
            innings >= 3 && dismissals > 0
              ? Number((runs / dismissals).toFixed(2))
              : null,
          strikeRate:
            totalBalls > 0
              ? Number(((runs / totalBalls) * 100).toFixed(2))
              : null,
          fours: Number(row.totalFours),
          sixes: Number(row.totalSixes),
          fifties: Number(row.fifties),
          hundreds: Number(row.hundreds),
        };
      }),
    };
  };
}

/**
 * Get aggregated bowling stats for a season, grouped by player.
 */
export function listBowlingLeaderboard(db: Kysely<DB>) {
  return async (params: CricketLeaderboardQuery) => {
    // Convert cricket overs (e.g. "5.3") to total balls using PostgreSQL string functions
    const oversToBalls = sql<number>`
      CASE
        WHEN POSITION('.' IN b.overs) > 0
        THEN CAST(SUBSTRING(b.overs FROM 1 FOR POSITION('.' IN b.overs) - 1) AS INTEGER) * 6
             + CAST(SUBSTRING(b.overs FROM POSITION('.' IN b.overs) + 1) AS INTEGER)
        ELSE CAST(b.overs AS INTEGER) * 6
      END
    `;

    let query = db
      .selectFrom("match_performance_bowling as b")
      .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
      .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
      .where("b.season", "=", params.season)
      .groupBy(["b.player_id", "b.player_name", "m.contentful_entry_id"])
      .select([
        "b.player_id as playerId",
        "b.player_name as playerName",
        "m.contentful_entry_id as contentfulEntryId",
      ])
      .select((eb) => [
        eb.fn.countAll().as("matches"),
        eb.fn.sum<string>("b.wickets").as("totalWickets"),
        eb.fn.sum<string>("b.runs").as("totalRuns"),
        eb.fn.sum<string>("b.maidens").as("totalMaidens"),
        eb.fn.max("b.wickets").as("bestWickets"),
        sql<string>`SUM(${oversToBalls})`.as("totalBalls"),
      ])
      .orderBy(sql`SUM(b.wickets)`, "desc")
      .limit(params.limit);

    if (params.isJunior !== undefined) {
      query = query.where("t.is_junior", "=", params.isJunior);
    }

    if (params.teamId) {
      query = query.where("b.team_id", "=", params.teamId);
    }

    if (params.competitionTypes) {
      const types = params.competitionTypes
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length > 0) {
        query = query.where("b.competition_type", "in", types);
      }
    }

    const rows = await query.execute();

    return {
      entries: rows.map((row) => {
        const wickets = Number(row.totalWickets);
        const runs = Number(row.totalRuns);
        const totalBalls = Number(row.totalBalls);
        const totalOvers = Math.floor(totalBalls / 6);
        const remainingBalls = totalBalls % 6;

        return {
          playerId: row.playerId,
          playerName: row.playerName,
          contentfulEntryId: row.contentfulEntryId,
          matches: Number(row.matches),
          overs: `${totalOvers}.${remainingBalls}`,
          maidens: Number(row.totalMaidens),
          runs,
          wickets,
          average:
            totalBalls >= 60 && wickets > 0
              ? Number((runs / wickets).toFixed(2))
              : null,
          economy:
            totalBalls > 0
              ? Number((runs / (totalBalls / 6)).toFixed(2))
              : null,
          strikeRate:
            totalBalls >= 60 && wickets > 0
              ? Number((totalBalls / wickets).toFixed(1))
              : null,
          bestWickets: Number(row.bestWickets),
        };
      }),
    };
  };
}
