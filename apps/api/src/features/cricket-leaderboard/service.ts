import type { DB } from "@percy-main/db";
import { type Kysely, sql } from "kysely";
import type { CricketLeaderboardQuery } from "./schemas.ts";

/**
 * Get aggregated batting stats for a season, grouped by player.
 */
export function listBattingLeaderboard(db: Kysely<DB>) {
  return async (params: CricketLeaderboardQuery) => {
    let query = db
      .selectFrom("match_performance_batting as b")
      .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
      .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
      .where("b.game_type", "=", params.gameType)
      .groupBy(["b.player_id", "m.slug"])
      .select(["b.player_id as playerId", "m.slug"])
      .select((eb) => [
        eb.fn.max("b.player_name").as("playerName"),
        eb.fn.countAll().as("innings"),
        eb.fn.sum<string>("b.runs").as("totalRuns"),
        // Sum of dismissals across all innings: 0/1 per innings in hardball,
        // 0..n per innings in Pairs (a batter can be out twice). Drives the
        // unified average formula below.
        eb.fn.sum<string>("b.times_out").as("totalTimesOut"),
        // Net-runs penalty applied by Play Cricket for Pairs games (5 runs
        // per dismissal in a 200-base game). 0 for hardball, so the unified
        // formula collapses to standard runs / dismissals.
        eb.fn
          .sum<string>(sql<number>`b.times_out * b.dismissal_penalty`)
          .as("totalPenaltyRuns"),
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

    if (params.season !== undefined) {
      query = query.where("b.season", "=", params.season);
    }

    if (params.isJunior !== undefined) {
      query = query.where("t.is_junior", "=", params.isJunior);
    }

    if (params.teamId) {
      query = query.where("b.team_id", "=", params.teamId);
    }

    if (params.competitionTypes) {
      const types = params.competitionTypes
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (types.length > 0) {
        query = query.where(sql`LOWER(b.competition_type)`, "in", types);
      }
    }

    const rows = await query.execute();

    return {
      entries: rows.map((row) => {
        const innings = Number(row.innings);
        const timesOut = Number(row.totalTimesOut);
        const penaltyRuns = Number(row.totalPenaltyRuns);
        const runs = Number(row.totalRuns);
        const totalBalls = Number(row.totalBalls);

        // Unified average: (runs − times_out × penalty_per_out) / times_out.
        // For hardball the penalty is 0, so this is the conventional average.
        // For Pairs it matches Play Cricket's "Net average" calculation.
        const average =
          innings >= 3 && timesOut > 0
            ? Number(((runs - penaltyRuns) / timesOut).toFixed(2))
            : null;

        return {
          playerId: row.playerId,
          playerName: row.playerName,
          slug: row.slug,
          innings,
          // Innings where the batter was never dismissed (could include
          // softball innings where they batted out their balls).
          notOuts: Math.max(innings - timesOut, 0),
          runs,
          highScore: row.highScore,
          average,
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
        WHEN b.overs IS NULL OR b.overs = '' THEN 0
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
      .where("b.game_type", "=", params.gameType)
      .groupBy(["b.player_id", "m.slug"])
      .select(["b.player_id as playerId", "m.slug"])
      .select((eb) => [
        eb.fn.max("b.player_name").as("playerName"),
        eb.fn.countAll().as("matches"),
        eb.fn.sum<string>("b.wickets").as("totalWickets"),
        eb.fn.sum<string>("b.runs").as("totalRuns"),
        eb.fn.sum<string>("b.maidens").as("totalMaidens"),
        // Encode best bowling as composite: most wickets wins, fewest runs breaks ties
        sql<string>`MAX(b.wickets * 10000 - b.runs)`.as("bestBowlingScore"),
        sql<string>`SUM(${oversToBalls})`.as("totalBalls"),
      ])
      .orderBy(sql`SUM(b.wickets)`, "desc")
      .limit(params.limit);

    if (params.season !== undefined) {
      query = query.where("b.season", "=", params.season);
    }

    if (params.isJunior !== undefined) {
      query = query.where("t.is_junior", "=", params.isJunior);
    }

    if (params.teamId) {
      query = query.where("b.team_id", "=", params.teamId);
    }

    if (params.competitionTypes) {
      const types = params.competitionTypes
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (types.length > 0) {
        query = query.where(sql`LOWER(b.competition_type)`, "in", types);
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
          slug: row.slug,
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
          bestBowling: (() => {
            const score = Number(row.bestBowlingScore);
            const bestW = Math.floor((score + 9999) / 10000);
            const bestR = bestW * 10000 - score;
            return `${bestW}/${bestR}`;
          })(),
        };
      }),
    };
  };
}
