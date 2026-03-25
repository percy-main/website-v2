import type { DB } from "@percy-main/db";
import { type Kysely, sql } from "kysely";
import type { RecordsQuery } from "./schemas.ts";

interface RecordEntry {
  playerName: string;
  slug: string | null;
  value: string;
  season: number;
}

interface HonourEntry {
  playerName: string;
  slug: string | null;
  value: string;
  season: number;
  matchDate: string;
}

/**
 * Fetch all-time club records: highest score, best bowling, season bests, career bests.
 */
export function getRecords(db: Kysely<DB>) {
  return async (params: RecordsQuery) => {
    const isJunior = params.isJunior ?? false;

    const [
      highestScore,
      bestBowling,
      mostRunsSeason,
      mostWicketsSeason,
      mostCareerRuns,
      mostCareerWickets,
      mostCareerMatches,
    ] = await Promise.all([
      getHighestScore(db, isJunior),
      getBestBowling(db, isJunior),
      getMostRunsSeason(db, isJunior),
      getMostWicketsSeason(db, isJunior),
      getMostCareerRuns(db, isJunior),
      getMostCareerWickets(db, isJunior),
      getMostCareerMatches(db, isJunior),
    ]);

    return {
      records: [
        { title: "Highest Individual Score", entry: highestScore },
        { title: "Most Runs in a Season", entry: mostRunsSeason },
        { title: "Most Career Runs", entry: mostCareerRuns },
        { title: "Most Matches", entry: mostCareerMatches },
        { title: "Best Bowling Figures", entry: bestBowling },
        { title: "Most Wickets in a Season", entry: mostWicketsSeason },
        { title: "Most Career Wickets", entry: mostCareerWickets },
      ]
        .filter(
          (r): r is { title: string; entry: RecordEntry } => r.entry !== null,
        )
        .map((r) => ({ title: r.title, ...r.entry })),
    };
  };
}

/**
 * Fetch the honours board: all 100+ scores and 5+ wicket hauls.
 */
export function getHonoursBoard(db: Kysely<DB>) {
  return async (params: RecordsQuery) => {
    const isJunior = params.isJunior ?? false;

    const [centuries, fiveWicketHauls] = await Promise.all([
      getCenturies(db, isJunior),
      getFiveWicketHauls(db, isJunior),
    ]);

    return { centuries, fiveWicketHauls };
  };
}

// --- Individual record queries ---

async function getHighestScore(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<RecordEntry | null> {
  const row = await db
    .selectFrom("match_performance_batting as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .select([
      "b.player_name as playerName",
      "m.slug",
      "b.runs",
      "b.not_out as notOut",
      "b.season",
    ])
    .orderBy("b.runs", "desc")
    .orderBy(sql`CASE WHEN b.not_out THEN 0 ELSE 1 END`, "asc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    playerName: row.playerName,
    slug: row.slug,
    value: `${row.runs}${row.notOut ? "*" : ""}`,
    season: row.season,
  };
}

async function getBestBowling(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<RecordEntry | null> {
  const row = await db
    .selectFrom("match_performance_bowling as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .select([
      "b.player_name as playerName",
      "m.slug",
      "b.wickets",
      "b.runs",
      "b.season",
    ])
    .orderBy("b.wickets", "desc")
    .orderBy("b.runs", "asc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    playerName: row.playerName,
    slug: row.slug,
    value: `${row.wickets}/${row.runs}`,
    season: row.season,
  };
}

async function getMostRunsSeason(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<RecordEntry | null> {
  const row = await db
    .selectFrom("match_performance_batting as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .groupBy(["b.player_id", "b.season", "m.slug"])
    .select([
      sql<string>`MAX(b.player_name)`.as("playerName"),
      "m.slug",
      sql<string>`SUM(b.runs)`.as("totalRuns"),
      "b.season",
    ])
    .orderBy(sql`SUM(b.runs)`, "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    playerName: row.playerName,
    slug: row.slug,
    value: String(Number(row.totalRuns)),
    season: row.season,
  };
}

async function getMostWicketsSeason(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<RecordEntry | null> {
  const row = await db
    .selectFrom("match_performance_bowling as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .groupBy(["b.player_id", "b.season", "m.slug"])
    .select([
      sql<string>`MAX(b.player_name)`.as("playerName"),
      "m.slug",
      sql<string>`SUM(b.wickets)`.as("totalWickets"),
      "b.season",
    ])
    .orderBy(sql`SUM(b.wickets)`, "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    playerName: row.playerName,
    slug: row.slug,
    value: String(Number(row.totalWickets)),
    season: row.season,
  };
}

async function getMostCareerRuns(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<RecordEntry | null> {
  const row = await db
    .selectFrom("match_performance_batting as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .groupBy(["b.player_id", "m.slug"])
    .select([
      sql<string>`MAX(b.player_name)`.as("playerName"),
      "m.slug",
      sql<string>`SUM(b.runs)`.as("totalRuns"),
    ])
    .orderBy(sql`SUM(b.runs)`, "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    playerName: row.playerName,
    slug: row.slug,
    value: String(Number(row.totalRuns)),
    season: 0,
  };
}

async function getMostCareerWickets(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<RecordEntry | null> {
  const row = await db
    .selectFrom("match_performance_bowling as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .groupBy(["b.player_id", "m.slug"])
    .select([
      sql<string>`MAX(b.player_name)`.as("playerName"),
      "m.slug",
      sql<string>`SUM(b.wickets)`.as("totalWickets"),
    ])
    .orderBy(sql`SUM(b.wickets)`, "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    playerName: row.playerName,
    slug: row.slug,
    value: String(Number(row.totalWickets)),
    season: 0,
  };
}

async function getMostCareerMatches(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<RecordEntry | null> {
  const row = await db
    .selectFrom("match_performance_batting as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .groupBy(["b.player_id", "m.slug"])
    .select([
      sql<string>`MAX(b.player_name)`.as("playerName"),
      "m.slug",
      sql<string>`COUNT(DISTINCT b.match_id)`.as("totalMatches"),
    ])
    .orderBy(sql`COUNT(DISTINCT b.match_id)`, "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return {
    playerName: row.playerName,
    slug: row.slug,
    value: String(Number(row.totalMatches)),
    season: 0,
  };
}

// --- Honours board queries ---

async function getCenturies(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<HonourEntry[]> {
  const rows = await db
    .selectFrom("match_performance_batting as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .where("b.runs", ">=", 100)
    .select([
      "b.player_name as playerName",
      "m.slug",
      "b.runs",
      "b.not_out as notOut",
      "b.season",
      "b.match_date as matchDate",
    ])
    .orderBy("b.runs", "desc")
    .orderBy("b.match_date", "desc")
    .execute();

  return rows.map((row) => ({
    playerName: row.playerName,
    slug: row.slug,
    value: `${row.runs}${row.notOut ? "*" : ""}`,
    season: row.season,
    matchDate: row.matchDate,
  }));
}

async function getFiveWicketHauls(
  db: Kysely<DB>,
  isJunior: boolean,
): Promise<HonourEntry[]> {
  const rows = await db
    .selectFrom("match_performance_bowling as b")
    .innerJoin("play_cricket_team as t", "t.id", "b.team_id")
    .leftJoin("member as m", "m.play_cricket_id", "b.player_id")
    .where("t.is_junior", "=", isJunior)
    .where("b.wickets", ">=", 5)
    .select([
      "b.player_name as playerName",
      "m.slug",
      "b.wickets",
      "b.runs",
      "b.season",
      "b.match_date as matchDate",
    ])
    .orderBy("b.wickets", "desc")
    .orderBy("b.runs", "asc")
    .orderBy("b.match_date", "desc")
    .execute();

  return rows.map((row) => ({
    playerName: row.playerName,
    slug: row.slug,
    value: `${row.wickets}/${row.runs}`,
    season: row.season,
    matchDate: row.matchDate,
  }));
}
