import { client } from "@percy-main/db";
import { sql } from "kysely";
import * as apiClient from "./api-client.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getMatchDetail(matchId: string) {
  // Check cache first
  const cached = await client
    .selectFrom("play_cricket_match_cache")
    .where("match_id", "=", matchId)
    .selectAll()
    .executeTakeFirst();

  if (cached && cached.fetched_at) {
    const fetchedAt = new Date(cached.fetched_at).getTime();
    if (Date.now() - fetchedAt < CACHE_TTL_MS) {
      return JSON.parse(cached.data as string);
    }
  }

  // Fetch from API
  const data = await apiClient.getMatchDetail(matchId);

  // Upsert cache
  if (cached) {
    await client
      .updateTable("play_cricket_match_cache")
      .set({
        data: JSON.stringify(data),
        fetched_at: new Date().toISOString(),
      })
      .where("match_id", "=", matchId)
      .execute();
  } else {
    await client
      .insertInto("play_cricket_match_cache")
      .values({
        match_id: matchId,
        data: JSON.stringify(data),
        match_date: data.match_date ?? new Date().toISOString().split("T")[0],
        fetched_at: new Date().toISOString(),
      })
      .execute();
  }

  return data;
}

export async function getResultSummary(
  matchId: string,
  season: number,
  ourTeamId: string,
) {
  const result = await client
    .selectFrom("match_result")
    .where("match_id", "=", matchId)
    .selectAll()
    .executeTakeFirst();

  if (!result) {
    return null;
  }

  return {
    matchId,
    season,
    ourTeamId,
    outcome: result.result,
    description: result.result_description,
    resultAppliedTo: result.result_applied_to,
  };
}

export async function getLeagueTable(divisionId: string) {
  const data = await apiClient.getLeagueTable(divisionId);
  return data;
}

export async function getTeams() {
  const teams = await client
    .selectFrom("play_cricket_team")
    .selectAll()
    .execute();

  return { teams };
}

export async function getLiveScores() {
  const today = new Date().toISOString().split("T")[0];

  // Get matches happening today by checking match_performance tables
  const todayMatches = await client
    .selectFrom("match_performance_batting")
    .where("match_date", "=", today)
    .select(["match_id", "match_date"])
    .distinct()
    .execute();

  if (todayMatches.length === 0) {
    return { matches: [] };
  }

  const matchIds = todayMatches.map((m) => m.match_id);

  // Get batting performances for today's matches
  const batting = await client
    .selectFrom("match_performance_batting")
    .where("match_id", "in", matchIds)
    .selectAll()
    .execute();

  // Get bowling performances for today's matches
  const bowling = await client
    .selectFrom("match_performance_bowling")
    .where("match_id", "in", matchIds)
    .selectAll()
    .execute();

  // Group by match
  const matchMap = new Map<
    string,
    {
      matchId: string;
      matchDate: string;
      batting: typeof batting;
      bowling: typeof bowling;
      status: string;
    }
  >();

  for (const match of todayMatches) {
    matchMap.set(match.match_id, {
      matchId: match.match_id,
      matchDate: match.match_date as string,
      batting: batting.filter((b) => b.match_id === match.match_id),
      bowling: bowling.filter((b) => b.match_id === match.match_id),
      status: "in_progress", // If we have data rows, match is at least in progress
    });
  }

  return { matches: Array.from(matchMap.values()) };
}

export async function getPlayerCareerStats(contentfulEntryId: string) {
  // Look up play_cricket_id via member table
  const member = await client
    .selectFrom("member")
    .where("contentful_entry_id", "=", contentfulEntryId)
    .select(["play_cricket_id"])
    .executeTakeFirst();

  if (!member?.play_cricket_id) {
    return null;
  }

  const playCricketId = member.play_cricket_id;

  // Aggregate batting stats grouped by season
  const battingBySeasonRows = await client
    .selectFrom("match_performance_batting")
    .where("player_id", "=", playCricketId)
    .select([
      "season",
      sql<number>`count(*)`.as("innings"),
      sql<number>`sum(runs)`.as("total_runs"),
      sql<number>`max(runs)`.as("high_score"),
      sql<number>`count(case when how_out = 'not out' then 1 end)`.as(
        "not_outs",
      ),
    ])
    .groupBy("season")
    .orderBy("season", "desc")
    .execute();

  // Aggregate bowling stats grouped by season
  const bowlingBySeasonRows = await client
    .selectFrom("match_performance_bowling")
    .where("player_id", "=", playCricketId)
    .select([
      "season",
      sql<number>`count(*)`.as("innings"),
      sql<number>`sum(overs)`.as("total_overs"),
      sql<number>`sum(maidens)`.as("total_maidens"),
      sql<number>`sum(runs)`.as("total_runs_conceded"),
      sql<number>`sum(wickets)`.as("total_wickets"),
    ])
    .groupBy("season")
    .orderBy("season", "desc")
    .execute();

  // Calculate career totals
  const careerBatting = {
    matches: battingBySeasonRows.reduce((sum, s) => sum + s.innings, 0),
    runs: battingBySeasonRows.reduce((sum, s) => sum + s.total_runs, 0),
    highScore: Math.max(
      0,
      ...battingBySeasonRows.map((s) => s.high_score),
    ),
    notOuts: battingBySeasonRows.reduce((sum, s) => sum + s.not_outs, 0),
  };

  const careerBowling = {
    innings: bowlingBySeasonRows.reduce((sum, s) => sum + s.innings, 0),
    overs: bowlingBySeasonRows.reduce((sum, s) => sum + s.total_overs, 0),
    maidens: bowlingBySeasonRows.reduce(
      (sum, s) => sum + s.total_maidens,
      0,
    ),
    runsConceded: bowlingBySeasonRows.reduce(
      (sum, s) => sum + s.total_runs_conceded,
      0,
    ),
    wickets: bowlingBySeasonRows.reduce(
      (sum, s) => sum + s.total_wickets,
      0,
    ),
  };

  return {
    playCricketId,
    battingBySeasonRows,
    bowlingBySeasonRows,
    career: {
      batting: careerBatting,
      bowling: careerBowling,
    },
  };
}

export async function getPlayerSeasonStats(
  contentfulEntryId: string,
  season: number,
) {
  const member = await client
    .selectFrom("member")
    .where("contentful_entry_id", "=", contentfulEntryId)
    .select(["play_cricket_id"])
    .executeTakeFirst();

  if (!member?.play_cricket_id) {
    return null;
  }

  const playCricketId = member.play_cricket_id;

  const battingRows = await client
    .selectFrom("match_performance_batting")
    .where("player_id", "=", playCricketId)
    .where("season", "=", season)
    .selectAll()
    .execute();

  const bowlingRows = await client
    .selectFrom("match_performance_bowling")
    .where("player_id", "=", playCricketId)
    .where("season", "=", season)
    .selectAll()
    .execute();

  // Calculate batting averages
  const totalRuns = battingRows.reduce(
    (sum, r) => sum + ((r.runs as number) ?? 0),
    0,
  );
  const innings = battingRows.length;
  const notOuts = battingRows.filter(
    (r) => r.how_out === "not out",
  ).length;
  const dismissals = innings - notOuts;
  const battingAverage = dismissals > 0 ? totalRuns / dismissals : null;
  const highScore = innings > 0
    ? Math.max(...battingRows.map((r) => (r.runs as number) ?? 0))
    : 0;

  // Calculate bowling stats
  const totalWickets = bowlingRows.reduce(
    (sum, r) => sum + ((r.wickets as number) ?? 0),
    0,
  );
  const totalRunsConceded = bowlingRows.reduce(
    (sum, r) => sum + ((r.runs as number) ?? 0),
    0,
  );
  const totalOvers = bowlingRows.reduce(
    (sum, r) => sum + (parseFloat(r.overs) || 0),
    0,
  );
  const bowlingAverage =
    totalWickets > 0 ? totalRunsConceded / totalWickets : null;
  const strikeRate =
    totalWickets > 0 ? (totalOvers * 6) / totalWickets : null;

  return {
    playCricketId,
    season,
    batting: {
      innings,
      runs: totalRuns,
      notOuts,
      average: battingAverage,
      highScore,
    },
    bowling: {
      innings: bowlingRows.length,
      overs: totalOvers,
      wickets: totalWickets,
      runsConceded: totalRunsConceded,
      average: bowlingAverage,
      strikeRate,
    },
    battingRows,
    bowlingRows,
  };
}
