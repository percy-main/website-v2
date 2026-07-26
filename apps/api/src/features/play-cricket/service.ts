import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import * as apiClient from "./api-client.ts";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getMatchDetail(db: Kysely<DB>) {
  return async (matchId: string) => {
    // Check cache first
    const cached = await db
      .selectFrom("play_cricket_match_cache")
      .where("match_id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    let data: unknown;

    if (cached?.fetched_at) {
      const fetchedAt = new Date(cached.fetched_at).getTime();
      if (Date.now() - fetchedAt < CACHE_TTL_MS) {
        data = JSON.parse(cached.data) as unknown;
      }
    }

    if (data === undefined) {
      data = await apiClient.getMatchDetail(matchId);

      // The date lives on match_details[0] in the API response, not the
      // top level. Normalise DD/MM/YYYY (Play Cricket's wire format) to
      // ISO so this column matches the rest of our schema.
      const detail = (
        data as { match_details?: Array<{ match_date?: unknown }> }
      ).match_details?.[0];
      const rawDate =
        typeof detail?.match_date === "string" ? detail.match_date : null;
      const matchDateIso =
        rawDate && /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)
          ? `${rawDate.slice(6, 10)}-${rawDate.slice(3, 5)}-${rawDate.slice(0, 2)}`
          : (rawDate ?? new Date().toISOString().split("T")[0]);

      // Upsert cache with raw Play Cricket response — enrichment happens
      // after this so member slug changes are picked up on the next read.
      if (cached) {
        await db
          .updateTable("play_cricket_match_cache")
          .set({
            data: JSON.stringify(data),
            match_date: matchDateIso,
            fetched_at: new Date().toISOString(),
          })
          .where("match_id", "=", matchId)
          .execute();
      } else {
        await db
          .insertInto("play_cricket_match_cache")
          .values({
            match_id: matchId,
            data: JSON.stringify(data),
            match_date: matchDateIso,
            fetched_at: new Date().toISOString(),
          })
          .execute();
      }
    }

    await enrichMatchDetailWithMemberSlugs(db, data);
    return data;
  };
}

/**
 * Annotate each batting/bowling row with `batsman_member_slug` /
 * `bowler_member_slug` for Percy Main players, using a single
 * `member.play_cricket_id IN (...)` lookup (no N+1).
 */
async function enrichMatchDetailWithMemberSlugs(
  db: Kysely<DB>,
  data: unknown,
): Promise<void> {
  const matchDetails = (data as { match_details?: unknown[] } | null)
    ?.match_details;
  if (!Array.isArray(matchDetails) || matchDetails.length === 0) return;

  const match = matchDetails[0] as { innings?: unknown[] };
  const innings = match.innings;
  if (!Array.isArray(innings)) return;

  const playerIds = new Set<string>();
  for (const inn of innings) {
    const i = inn as { bat?: unknown[]; bowl?: unknown[] };
    for (const b of i.bat ?? []) {
      const bat = b as { batsman_id?: string; bowler_id?: string };
      if (bat.batsman_id) playerIds.add(bat.batsman_id);
      if (bat.bowler_id) playerIds.add(bat.bowler_id);
    }
    for (const b of i.bowl ?? []) {
      const bowl = b as { bowler_id?: string };
      if (bowl.bowler_id) playerIds.add(bowl.bowler_id);
    }
  }

  if (playerIds.size === 0) return;

  const members = await db
    .selectFrom("member")
    .where("play_cricket_id", "in", [...playerIds])
    .where("slug", "is not", null)
    .select(["play_cricket_id", "slug"])
    .execute();

  const slugByPcId = new Map<string, string>();
  for (const m of members) {
    if (m.play_cricket_id && m.slug) slugByPcId.set(m.play_cricket_id, m.slug);
  }
  if (slugByPcId.size === 0) return;

  for (const inn of innings) {
    const i = inn as { bat?: unknown[]; bowl?: unknown[] };
    for (const b of i.bat ?? []) {
      const bat = b as Record<string, unknown> & {
        batsman_id?: string;
        bowler_id?: string;
      };
      if (bat.batsman_id && slugByPcId.has(bat.batsman_id)) {
        bat.batsman_member_slug = slugByPcId.get(bat.batsman_id);
      }
      if (bat.bowler_id && slugByPcId.has(bat.bowler_id)) {
        bat.bowler_member_slug = slugByPcId.get(bat.bowler_id);
      }
    }
    for (const b of i.bowl ?? []) {
      const bowl = b as Record<string, unknown> & { bowler_id?: string };
      if (bowl.bowler_id && slugByPcId.has(bowl.bowler_id)) {
        bowl.bowler_member_slug = slugByPcId.get(bowl.bowler_id);
      }
    }
  }
}

export function getResultSummary(db: Kysely<DB>) {
  return async (matchId: string, season: number, ourTeamId: string) => {
    const result = await db
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
  };
}

export function getLeagueTable() {
  return async (divisionId: string) => {
    const raw = (await apiClient.getLeagueTable(divisionId)) as {
      league_table: Array<{
        id: number;
        division_name: string;
        headings: Record<string, string>;
        values: Array<Record<string, string>>;
        key: string;
      }>;
    };

    const table = raw.league_table[0];
    if (!table) return { columns: [], rows: [] };

    const headingKeys = Object.keys(table.headings);
    const columns = headingKeys.map((k) => table.headings[k]);

    const rows = table.values.map((row) => {
      const mapped: Record<string, string> = {
        position: row.position,
        team_id: row.team_id,
      };
      for (let i = 0; i < headingKeys.length; i++) {
        mapped[columns[i]] = row[headingKeys[i]] ?? "";
      }
      return mapped as { position: string; team_id: string } & Record<
        string,
        string
      >;
    });

    return { id: table.id, name: table.division_name, columns, rows };
  };
}

export function getTeams(db: Kysely<DB>) {
  return async () => {
    const teams = await db
      .selectFrom("play_cricket_team")
      .selectAll()
      .execute();

    return { teams };
  };
}

export function getLiveScores(db: Kysely<DB>) {
  return async () => {
    const today = new Date().toISOString().split("T")[0];

    // Get matches happening today by checking match_performance tables
    const todayMatches = await db
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
    const batting = await db
      .selectFrom("match_performance_batting")
      .where("match_id", "in", matchIds)
      .selectAll()
      .execute();

    // Get bowling performances for today's matches
    const bowling = await db
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
        matchDate: match.match_date,
        batting: batting.filter((b) => b.match_id === match.match_id),
        bowling: bowling.filter((b) => b.match_id === match.match_id),
        status: "in_progress", // If we have data rows, match is at least in progress
      });
    }

    return { matches: Array.from(matchMap.values()) };
  };
}

// Game types we expose on the player profile. Hardball ("Standard") first so
// it renders above softball when a player has both. Format labels surface in
// section headings on the frontend.
const GAME_TYPES = [
  { code: "Standard", label: "Hardball" },
  { code: "Pairs", label: "Softball" },
] as const;

export function getPlayerCareerStats(db: Kysely<DB>) {
  return async (slug: string) => {
    // Look up play_cricket_id via member table
    const member = await db
      .selectFrom("member")
      .where("slug", "=", slug)
      .select(["play_cricket_id"])
      .executeTakeFirst();

    if (!member?.play_cricket_id) {
      return null;
    }

    const playCricketId = member.play_cricket_id;

    // Convert cricket overs string to total balls
    const oversToBalls = sql<number>`
      CASE
        WHEN POSITION('.' IN overs) > 0
        THEN CAST(SUBSTRING(overs FROM 1 FOR POSITION('.' IN overs) - 1) AS INTEGER) * 6
             + CAST(SUBSTRING(overs FROM POSITION('.' IN overs) + 1) AS INTEGER)
        WHEN overs IS NULL THEN 0
        ELSE CAST(overs AS INTEGER) * 6
      END
    `;

    // Aggregate batting stats grouped by (season, game_type). The unified
    // average formula collapses to standard runs/dismissals for hardball
    // because dismissal_penalty is 0 there.
    const battingBySeasonRows = await db
      .selectFrom("match_performance_batting")
      .where("player_id", "=", playCricketId)
      // "Did not bat" appearance rows are not innings
      .where("did_bat", "=", true)
      .select([
        "season",
        "game_type",
        sql<string>`count(*)`.as("innings"),
        sql<string>`sum(runs)`.as("total_runs"),
        sql<string>`max(runs)`.as("high_score"),
        sql<string>`sum(times_out)`.as("total_times_out"),
        // Innings where the batter was never dismissed. Pairs allows
        // times_out > 1 in a single innings so we can't derive this from
        // innings − Σ times_out.
        sql<string>`sum(case when times_out = 0 then 1 else 0 end)`.as(
          "not_outs",
        ),
        sql<string>`sum(times_out * dismissal_penalty)`.as(
          "total_penalty_runs",
        ),
        sql<string>`sum(balls)`.as("total_balls"),
        sql<string>`sum(fours)`.as("total_fours"),
        sql<string>`sum(sixes)`.as("total_sixes"),
        sql<string>`sum(case when runs >= 50 and runs < 100 then 1 else 0 end)`.as(
          "fifties",
        ),
        sql<string>`sum(case when runs >= 100 then 1 else 0 end)`.as(
          "hundreds",
        ),
      ])
      .groupBy(["season", "game_type"])
      .orderBy("season", "desc")
      .execute();

    const bowlingBySeasonRows = await db
      .selectFrom("match_performance_bowling")
      .where("player_id", "=", playCricketId)
      .select([
        "season",
        "game_type",
        sql<string>`count(*)`.as("innings"),
        sql<string>`sum(maidens)`.as("total_maidens"),
        sql<string>`sum(runs)`.as("total_runs_conceded"),
        sql<string>`sum(wickets)`.as("total_wickets"),
        sql<string>`SUM(${oversToBalls})`.as("total_balls"),
        sql<string>`max(wickets)`.as("best_wickets"),
      ])
      .groupBy(["season", "game_type"])
      .orderBy("season", "desc")
      .execute();

    // Best bowling figures per (season, game_type)
    const bestBowlingPerSeason = await db
      .selectFrom("match_performance_bowling")
      .where("player_id", "=", playCricketId)
      .select([
        "season",
        "game_type",
        sql<string>`wickets`.as("wickets"),
        sql<string>`runs`.as("runs"),
      ])
      .where(
        sql`(season, game_type, wickets, runs)`,
        "in",
        sql`(
          SELECT season, game_type, wickets, MIN(runs)
          FROM match_performance_bowling
          WHERE player_id = ${playCricketId}
          AND wickets = (
            SELECT MAX(wickets) FROM match_performance_bowling b2
            WHERE b2.player_id = ${playCricketId}
              AND b2.season = match_performance_bowling.season
              AND b2.game_type = match_performance_bowling.game_type
          )
          GROUP BY season, game_type, wickets
        )`,
      )
      .execute();

    const bestBowlingPerSeasonByFormat = new Map<string, Map<number, string>>();
    for (const row of bestBowlingPerSeason) {
      const key = row.game_type;
      let inner = bestBowlingPerSeasonByFormat.get(key);
      if (!inner) {
        inner = new Map();
        bestBowlingPerSeasonByFormat.set(key, inner);
      }
      inner.set(row.season, `${row.wickets}/${row.runs}`);
    }

    // Best bowling figures overall, computed per game_type. A player can
    // have rows in both Standard and Pairs and we want the top figures
    // for each, not a single global winner. Reduce in JS - small data,
    // and the subquery / window patterns are awkward to mock in
    // service.test.ts.
    const allBowlingRows = await db
      .selectFrom("match_performance_bowling")
      .where("player_id", "=", playCricketId)
      .select(["game_type", "wickets", "runs"])
      .execute();

    const bestBowlingOverallByFormat = new Map<
      string,
      { wickets: number; runs: number }
    >();
    for (const row of allBowlingRows) {
      const wickets = row.wickets ?? 0;
      const runs = row.runs ?? 0;
      const current = bestBowlingOverallByFormat.get(row.game_type);
      const isBetter =
        !current ||
        wickets > current.wickets ||
        (wickets === current.wickets && runs < current.runs);
      if (isBetter) {
        bestBowlingOverallByFormat.set(row.game_type, { wickets, runs });
      }
    }

    const formats = GAME_TYPES.map(({ code, label }) => {
      const battingSeasons = battingBySeasonRows
        .filter((r) => r.game_type === code)
        .map((row) => {
          const innings = Number(row.innings);
          const timesOut = Number(row.total_times_out);
          const penaltyRuns = Number(row.total_penalty_runs);
          const runs = Number(row.total_runs);
          const totalBalls = Number(row.total_balls);
          // Unified: (runs − times_out × penalty_per_out) / times_out.
          // Hardball has dismissal_penalty = 0 so this is the standard
          // batting average; softball matches Play Cricket's net average.
          const average =
            innings >= 3 && timesOut > 0
              ? Number(((runs - penaltyRuns) / timesOut).toFixed(2))
              : null;
          return {
            season: row.season,
            innings,
            notOuts: Number(row.not_outs),
            runs,
            highScore: Number(row.high_score),
            average,
            strikeRate:
              totalBalls > 0
                ? Number(((runs / totalBalls) * 100).toFixed(1))
                : null,
            fours: Number(row.total_fours),
            sixes: Number(row.total_sixes),
            fifties: Number(row.fifties),
            hundreds: Number(row.hundreds),
          };
        });

      const bowlingSeasons = bowlingBySeasonRows
        .filter((r) => r.game_type === code)
        .map((row) => {
          const totalBalls = Number(row.total_balls);
          const wickets = Number(row.total_wickets);
          const runs = Number(row.total_runs_conceded);
          const totalOvers = Math.floor(totalBalls / 6);
          const remainingBalls = totalBalls % 6;
          return {
            season: row.season,
            innings: Number(row.innings),
            overs: `${totalOvers}.${remainingBalls}`,
            maidens: Number(row.total_maidens),
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
            bestBowling:
              bestBowlingPerSeasonByFormat.get(code)?.get(row.season) ?? null,
          };
        });

      const seasons = [
        ...new Set([
          ...battingSeasons.map((s) => s.season),
          ...bowlingSeasons.map((s) => s.season),
        ]),
      ].sort((a, b) => b - a);

      const careerBatting = {
        matches: battingSeasons.reduce((sum, s) => sum + s.innings, 0),
        runs: battingSeasons.reduce((sum, s) => sum + s.runs, 0),
        highScore: Math.max(0, ...battingSeasons.map((s) => s.highScore)),
        notOuts: battingSeasons.reduce((sum, s) => sum + s.notOuts, 0),
      };

      const careerBowling = {
        innings: bowlingSeasons.reduce((sum, s) => sum + s.innings, 0),
        wickets: bowlingSeasons.reduce((sum, s) => sum + s.wickets, 0),
        bestBowling: bestBowlingOverallByFormat.get(code) ?? null,
      };

      return {
        gameType: code,
        label,
        seasons,
        battingSeasons,
        bowlingSeasons,
        career: { batting: careerBatting, bowling: careerBowling },
      };
      // Drop formats with no batting and no bowling — the profile renders one
      // section per remaining format, never an empty "Softball" card.
    }).filter(
      (f) => f.battingSeasons.length > 0 || f.bowlingSeasons.length > 0,
    );

    return {
      playCricketId,
      formats,
    };
  };
}

export function getPlayerSeasonStats(db: Kysely<DB>) {
  return async (
    slug: string,
    season: number,
    gameType: "Standard" | "Pairs" = "Standard",
  ) => {
    const member = await db
      .selectFrom("member")
      .where("slug", "=", slug)
      .select(["play_cricket_id"])
      .executeTakeFirst();

    if (!member?.play_cricket_id) {
      return null;
    }

    const playCricketId = member.play_cricket_id;

    const battingRows = await db
      .selectFrom("match_performance_batting")
      .where("player_id", "=", playCricketId)
      .where("season", "=", season)
      .where("game_type", "=", gameType)
      // "Did not bat" appearance rows are not innings
      .where("did_bat", "=", true)
      .selectAll()
      .execute();

    const bowlingRows = await db
      .selectFrom("match_performance_bowling")
      .where("player_id", "=", playCricketId)
      .where("season", "=", season)
      .where("game_type", "=", gameType)
      .selectAll()
      .execute();

    // Calculate batting aggregates using the unified formula:
    //   avg = (runs − times_out × dismissal_penalty) / times_out
    // For hardball dismissal_penalty is 0 so this collapses to the standard
    // runs / dismissals. For Pairs it matches Play Cricket's net average.
    const totalRuns = battingRows.reduce((sum, r) => sum + (r.runs ?? 0), 0);
    const innings = battingRows.length;
    const totalTimesOut = battingRows.reduce(
      (sum, r) => sum + (r.times_out ?? 0),
      0,
    );
    const totalPenaltyRuns = battingRows.reduce(
      (sum, r) => sum + (r.times_out ?? 0) * (r.dismissal_penalty ?? 0),
      0,
    );
    // Count innings where the batter was never dismissed. Pairs allows
    // times_out > 1 in a single innings so we can't subtract from innings.
    const notOuts = battingRows.filter((r) => (r.times_out ?? 0) === 0).length;
    const battingAverage =
      innings >= 3 && totalTimesOut > 0
        ? (totalRuns - totalPenaltyRuns) / totalTimesOut
        : null;
    const highScore =
      innings > 0 ? Math.max(...battingRows.map((r) => r.runs ?? 0)) : 0;
    const totalBalls = battingRows.reduce((sum, r) => sum + (r.balls ?? 0), 0);
    const battingStrikeRate =
      totalBalls > 0 ? (totalRuns / totalBalls) * 100 : null;
    const fours = battingRows.reduce((sum, r) => sum + (r.fours ?? 0), 0);
    const sixes = battingRows.reduce((sum, r) => sum + (r.sixes ?? 0), 0);
    const fifties = battingRows.filter(
      (r) => (r.runs ?? 0) >= 50 && (r.runs ?? 0) < 100,
    ).length;
    const hundreds = battingRows.filter((r) => (r.runs ?? 0) >= 100).length;

    // Calculate bowling aggregates
    const totalWickets = bowlingRows.reduce(
      (sum, r) => sum + (r.wickets ?? 0),
      0,
    );
    const totalRunsConceded = bowlingRows.reduce(
      (sum, r) => sum + (r.runs ?? 0),
      0,
    );
    const totalMaidens = bowlingRows.reduce(
      (sum, r) => sum + (r.maidens ?? 0),
      0,
    );

    // Convert cricket overs to total balls for proper aggregation
    let totalBowlingBalls = 0;
    for (const r of bowlingRows) {
      const parts = (r.overs ?? "0").split(".");
      const completedOvers = parseInt(parts[0], 10) || 0;
      const extraBalls = parts[1] ? parseInt(parts[1], 10) : 0;
      totalBowlingBalls += completedOvers * 6 + extraBalls;
    }

    const totalOversDisplay = `${Math.floor(totalBowlingBalls / 6)}.${totalBowlingBalls % 6}`;
    const bowlingAverage =
      totalBowlingBalls >= 60 && totalWickets > 0
        ? totalRunsConceded / totalWickets
        : null;
    const economy =
      totalBowlingBalls > 0
        ? totalRunsConceded / (totalBowlingBalls / 6)
        : null;
    const bowlingStrikeRate =
      totalBowlingBalls >= 60 && totalWickets > 0
        ? totalBowlingBalls / totalWickets
        : null;

    // Best bowling this season
    const bestBowl =
      bowlingRows.length > 0
        ? bowlingRows.reduce((best, r) => {
            const w = r.wickets ?? 0;
            const runs = r.runs ?? 0;
            if (
              w > (best.wickets ?? 0) ||
              (w === (best.wickets ?? 0) && runs < (best.runs ?? 0))
            ) {
              return r;
            }
            return best;
          })
        : null;

    return {
      playCricketId,
      season,
      batting: {
        innings,
        runs: totalRuns,
        notOuts,
        average: battingAverage,
        highScore,
        strikeRate: battingStrikeRate,
        fours,
        sixes,
        fifties,
        hundreds,
      },
      bowling: {
        innings: bowlingRows.length,
        overs: totalOversDisplay,
        maidens: totalMaidens,
        wickets: totalWickets,
        runs: totalRunsConceded,
        average: bowlingAverage,
        economy,
        strikeRate: bowlingStrikeRate,
        bestBowling: bestBowl
          ? `${bestBowl.wickets ?? 0}/${bestBowl.runs ?? 0}`
          : null,
      },
    };
  };
}
