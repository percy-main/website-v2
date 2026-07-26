import type { DB } from "@percy-main/db";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";

import type { z } from "zod";
import { calculateFantasyScores } from "../fantasy/calculate-scores.ts";
import {
  GetMatchDetailResponse,
  MatchDetailBat,
  type MatchSummaryMatch,
} from "./api-schemas.ts";

import type { PlayCricketApiClient } from "./api-client.ts";
import type { RvClient } from "./rv-client.ts";
import { ingestRvDataForMatch } from "./rv-ingest.ts";

// --- Helpers ---

const JUNIOR_PATTERNS = [/under/i, /\bU\d{2}\b/, /junior/i, /colts/i];

function isJuniorTeam(teamName: string): boolean {
  return JUNIOR_PATTERNS.some((p) => p.test(teamName));
}

// Play Cricket sends how_out in a mixed format: abbreviations for
// bowler-credited dismissals ("ct", "b", "lbw", "st") but full text for
// everything else ("not out", "did not bat", "run out", "retired not out").
// Both spellings are listed as insurance against the API switching format.
// "retired out" and "run out" are deliberately absent: both count as
// dismissals for batting-average purposes.
const NOT_OUT_CODES = new Set([
  "no",
  "not out",
  "rtd",
  "retired",
  "retired hurt",
  "rtno",
  "retired not out",
  "",
]);

function isNotOut(howOut: string | null | undefined): boolean {
  if (!howOut) return true;
  return NOT_OUT_CODES.has(howOut.toLowerCase().trim());
}

// Players listed on the scorecard who never took strike. Stored with
// did_bat = false: they count as match appearances (fantasy team win bonus,
// career-matches record) but never as innings - anything aggregating
// innings or not-outs must filter on did_bat.
const DID_NOT_BAT_CODES = new Set(["dnb", "did not bat", "absent"]);

interface BatEntry {
  how_out?: string | null;
  runs?: string | null;
  balls?: string | null;
  times_out?: string | null;
}

// In Pairs (Women's Softball) every batter rotates after their allotted balls
// without a per-player dismissal code, so `how_out` is null for everyone who
// played. We can't use it as the sole "did this player bat" signal — fall
// back to runs, balls, and times_out, which softball does populate.
function didBat(bat: BatEntry): boolean {
  const code = (bat.how_out ?? "").toLowerCase().trim();
  if (DID_NOT_BAT_CODES.has(code)) return false;
  if (code !== "") return true;
  // Empty / null how_out: must have at least one quantitative signal that
  // this player took strike.
  const runs = parseInt(bat.runs ?? "");
  const balls = parseInt(bat.balls ?? "");
  const timesOut = parseInt(bat.times_out ?? "");
  return (
    (Number.isFinite(runs) && runs !== 0) ||
    (Number.isFinite(balls) && balls > 0) ||
    (Number.isFinite(timesOut) && timesOut > 0)
  );
}

// Whether the scorecard actually says anything about this player. Rows with
// no how_out and no quantitative signal are placeholder padding (common in
// Pairs cards) and are not stored at all — unlike explicit "did not bat"
// rows, which are stored as appearances.
function hasScorecardEntry(bat: BatEntry): boolean {
  const code = (bat.how_out ?? "").toLowerCase().trim();
  return code !== "" || didBat(bat);
}

function parseDismissalType(
  howOut: string | null | undefined,
): "catch" | "stumping" | "run_out" | null {
  if (!howOut) return null;
  const code = howOut.toLowerCase().trim();
  if (code === "ct" || code.startsWith("caught")) return "catch";
  if (code === "st" || code.startsWith("stumped")) return "stumping";
  if (code === "ro" || code.includes("run out")) return "run_out";
  return null;
}

// --- Types ---

export interface SyncConfig {
  siteId: string;
  /** Additional past seasons to sync (e.g. [2025]). Current year is always included. */
  extraSeasons?: number[];
}

export interface SyncResult {
  matchesProcessed: number;
  errors: string[];
}

interface FieldingAgg {
  playerName: string;
  catches: number;
  runOuts: number;
  stumpings: number;
  isWicketkeeper: boolean;
}

// --- Exported for testing ---

export {
  didBat,
  hasScorecardEntry,
  isJuniorTeam,
  isNotOut,
  parseDismissalType,
};

// --- Main sync logic ---

const DEADLINE_MS = 10 * 60 * 1000; // 10 minutes
const RESYNC_WINDOW_DAYS = 7;

type MatchDetailType = z.output<
  typeof GetMatchDetailResponse
>["match_details"][number];

function getWicketkeeperIds(
  players: MatchDetailType["players"],
  teamSide: "home" | "away",
): Set<string> {
  const keeperIds = new Set<string>();
  for (const group of players) {
    const squad = teamSide === "home" ? group.home_team : group.away_team;
    if (!squad) continue;
    for (const player of squad) {
      if (player.wicket_keeper && player.player_id != null) {
        keeperIds.add(player.player_id.toString());
      }
    }
  }
  return keeperIds;
}

function extractFieldingCredits(
  batEntries: Array<z.output<typeof MatchDetailBat>>,
  keeperIds: Set<string>,
): Map<string, FieldingAgg> {
  const fielders = new Map<string, FieldingAgg>();

  for (const bat of batEntries) {
    const dismissalType = parseDismissalType(bat.how_out);
    if (!dismissalType) continue;

    const fielderId = bat.fielder_id;
    const fielderName = bat.fielder_name;
    if (!fielderId || !fielderName) continue;

    let agg = fielders.get(fielderId);
    if (!agg) {
      agg = {
        playerName: fielderName,
        catches: 0,
        runOuts: 0,
        stumpings: 0,
        isWicketkeeper: keeperIds.has(fielderId),
      };
      fielders.set(fielderId, agg);
    }

    switch (dismissalType) {
      case "catch":
        agg.catches++;
        break;
      case "run_out":
        agg.runOuts++;
        break;
      case "stumping":
        agg.stumpings++;
        break;
    }
  }

  return fielders;
}

// --- Core sync ---

async function syncTeams(
  db: Kysely<DB>,
  api: PlayCricketApiClient,
  siteId: string,
  errors: string[],
): Promise<void> {
  try {
    const teamsData = await api.getTeams();

    for (const team of teamsData.teams) {
      const teamId = team.id.toString();
      await db
        .insertInto("play_cricket_team")
        .values({
          id: teamId,
          name: team.team_name,
          is_junior: isJuniorTeam(team.team_name),
          site_id: siteId,
          last_updated: team.last_updated,
        })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({
            name: team.team_name,
            is_junior: isJuniorTeam(team.team_name),
            last_updated: team.last_updated,
          }),
        )
        .execute();
    }
  } catch (err) {
    const msg = `Teams sync skipped: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
  }
}

async function upsertTeamFromMatch(
  db: Kysely<DB>,
  teamEntry: {
    id: string | undefined;
    name: string | undefined;
    clubId: string | undefined;
  },
  siteId: string,
): Promise<void> {
  if (!teamEntry.id || !teamEntry.name || teamEntry.clubId !== siteId) return;

  const { id, name } = teamEntry;

  await db
    .insertInto("play_cricket_team")
    .values({
      id,
      name,
      is_junior: isJuniorTeam(name),
      site_id: siteId,
      last_updated: new Date().toISOString(),
    })
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        name,
        is_junior: isJuniorTeam(name),
      }),
    )
    .execute();
}

async function storeBattingPerformances(
  db: Kysely<DB>,
  innings: Array<z.output<typeof MatchDetailBat>>,
  matchId: string,
  teamId: string,
  competitionType: string,
  matchDate: string,
  season: number,
  gameType: string,
  dismissalPenalty: number,
): Promise<void> {
  for (const bat of innings) {
    if (!hasScorecardEntry(bat)) continue;

    // "Did not bat" rows are appearances, not innings: no dismissal, and
    // not_out = false because there was no innings to be not out in.
    const didBatFlag = didBat(bat);

    // For Pairs games trust the API's per-batter times_out (can be 2+); for
    // Standard, derive it from not_out so the column stays consistent across
    // formats. The unified average formula relies on this column for both.
    const apiTimesOut = parseInt(bat.times_out ?? "");
    const timesOut = !didBatFlag
      ? 0
      : gameType === "Pairs" && Number.isFinite(apiTimesOut)
        ? apiTimesOut
        : isNotOut(bat.how_out)
          ? 0
          : 1;
    // Derive not_out from times_out for both formats. In Pairs, how_out is
    // null for every batter so the old how_out-based check would mark a
    // dismissed Pairs batter as not out, which would corrupt any consumer
    // still reading the legacy column.
    const notOut = didBatFlag && timesOut === 0;

    await db
      .insertInto("match_performance_batting")
      .values({
        id: crypto.randomUUID(),
        match_id: matchId,
        player_id: bat.batsman_id,
        player_name: bat.batsman_name,
        team_id: teamId,
        competition_type: competitionType,
        match_date: matchDate,
        season,
        runs: parseInt(bat.runs) || 0,
        balls: parseInt(bat.balls) || 0,
        fours: parseInt(bat.fours) || 0,
        sixes: parseInt(bat.sixes) || 0,
        how_out: bat.how_out ?? "",
        did_bat: didBatFlag,
        not_out: notOut,
        times_out: timesOut,
        dismissal_penalty: dismissalPenalty,
        game_type: gameType,
      })
      .onConflict((oc) =>
        oc.columns(["match_id", "player_id"]).doUpdateSet({
          player_name: bat.batsman_name,
          match_date: matchDate,
          runs: parseInt(bat.runs) || 0,
          balls: parseInt(bat.balls) || 0,
          fours: parseInt(bat.fours) || 0,
          sixes: parseInt(bat.sixes) || 0,
          how_out: bat.how_out ?? "",
          did_bat: didBatFlag,
          not_out: notOut,
          times_out: timesOut,
          dismissal_penalty: dismissalPenalty,
          game_type: gameType,
        }),
      )
      .execute();
  }
}

async function storeBowlingPerformances(
  db: Kysely<DB>,
  bowlers: Array<{
    bowler_name: string;
    bowler_id: string;
    overs: string;
    maidens: string;
    runs: string;
    wickets: string;
    wides: string;
    no_balls: string;
  }>,
  matchId: string,
  teamId: string,
  competitionType: string,
  matchDate: string,
  season: number,
  gameType: string,
): Promise<void> {
  for (const bowl of bowlers) {
    await db
      .insertInto("match_performance_bowling")
      .values({
        id: crypto.randomUUID(),
        match_id: matchId,
        player_id: bowl.bowler_id,
        player_name: bowl.bowler_name,
        team_id: teamId,
        competition_type: competitionType,
        match_date: matchDate,
        season,
        overs: bowl.overs,
        maidens: parseInt(bowl.maidens) || 0,
        runs: parseInt(bowl.runs) || 0,
        wickets: parseInt(bowl.wickets) || 0,
        wides: parseInt(bowl.wides) || 0,
        no_balls: parseInt(bowl.no_balls) || 0,
        game_type: gameType,
      })
      .onConflict((oc) =>
        oc.columns(["match_id", "player_id"]).doUpdateSet({
          player_name: bowl.bowler_name,
          match_date: matchDate,
          overs: bowl.overs,
          maidens: parseInt(bowl.maidens) || 0,
          runs: parseInt(bowl.runs) || 0,
          wickets: parseInt(bowl.wickets) || 0,
          wides: parseInt(bowl.wides) || 0,
          no_balls: parseInt(bowl.no_balls) || 0,
          game_type: gameType,
        }),
      )
      .execute();
  }
}

async function storeFieldingPerformances(
  db: Kysely<DB>,
  fieldingCredits: Map<string, FieldingAgg>,
  matchId: string,
  teamId: string,
  competitionType: string,
  matchDate: string,
  season: number,
  gameType: string,
): Promise<void> {
  for (const [fielderId, agg] of fieldingCredits) {
    await db
      .insertInto("match_performance_fielding")
      .values({
        id: crypto.randomUUID(),
        match_id: matchId,
        player_id: fielderId,
        player_name: agg.playerName,
        team_id: teamId,
        competition_type: competitionType,
        match_date: matchDate,
        season,
        catches: agg.catches,
        run_outs: agg.runOuts,
        stumpings: agg.stumpings,
        is_wicketkeeper: agg.isWicketkeeper,
        game_type: gameType,
      })
      .onConflict((oc) =>
        oc.columns(["match_id", "player_id"]).doUpdateSet({
          player_name: agg.playerName,
          match_date: matchDate,
          catches: agg.catches,
          run_outs: agg.runOuts,
          stumpings: agg.stumpings,
          is_wicketkeeper: agg.isWicketkeeper,
          game_type: gameType,
        }),
      )
      .execute();
  }
}

async function syncMatches(
  db: Kysely<DB>,
  api: PlayCricketApiClient,
  rv: RvClient | null,
  config: SyncConfig,
  startTime: number,
  log: FastifyBaseLogger,
): Promise<SyncResult> {
  const { siteId } = config;
  const errors: string[] = [];
  let matchesProcessed = 0;

  // Step 1: Sync teams (non-blocking)
  await syncTeams(db, api, siteId, errors);

  // Step 2: Fetch all matches for each season
  const currentYear = new Date().getFullYear();
  const seasons = [...(config.extraSeasons ?? []), currentYear];
  const allMatches: Array<{ match: MatchSummaryMatch; season: number }> = [];

  for (const season of seasons) {
    const matchesData = await api.getMatchesSummary(season);
    for (const match of matchesData.matches) {
      allMatches.push({ match, season });
    }
  }

  // Step 3: Load already-processed match IDs
  const processedRows = await db
    .selectFrom("match_result")
    .select("match_id")
    .distinct()
    .execute();
  const processedMatchIds = new Set(processedRows.map((r) => r.match_id));

  // Step 4: Process each match
  const resultCutoff = new Date();
  resultCutoff.setDate(resultCutoff.getDate() - 14);
  resultCutoff.setHours(0, 0, 0, 0);

  // Recent matches are re-fetched even if they already have a match_result
  // row, so that late scorecard fills (captain adding players hours or days
  // after the first sync) and result corrections actually land.
  const resyncCutoff = new Date();
  resyncCutoff.setDate(resyncCutoff.getDate() - RESYNC_WINDOW_DAYS);
  resyncCutoff.setHours(0, 0, 0, 0);

  for (const { match, season } of allMatches) {
    const matchId = match.id.toString();

    try {
      // Validate match_date format (DD/MM/YYYY) up front so we can use it for
      // the resync-window decision below.
      if (
        !match.match_date ||
        !/^\d{2}\/\d{2}\/\d{4}$/.test(match.match_date)
      ) {
        continue;
      }

      const [dd, mm, yyyy] = match.match_date.split("/");
      const matchDate = new Date(
        parseInt(yyyy),
        parseInt(mm) - 1,
        parseInt(dd),
      );
      // Store as ISO YYYY-MM-DD so it sorts and compares correctly as text.
      // The Play Cricket API emits DD/MM/YYYY which we don't keep on disk —
      // every consumer downstream wants ISO.
      const matchDateIso = `${yyyy}-${mm}-${dd}`;

      // Skip already-processed matches only when they're past the resync
      // window. Inside the window, re-fetch — all writes are idempotent
      // upserts, so this just refreshes performance + result rows.
      if (processedMatchIds.has(matchId) && matchDate < resyncCutoff) continue;

      // Stop after deadline
      if (Date.now() - startTime > DEADLINE_MS) {
        return { matchesProcessed, errors };
      }

      const detailData = await api.getMatchDetail(matchId);
      const detail = detailData.match_details[0];
      if (!detail) continue;

      // Must have at least one innings with batting data
      const hasScorecard = detail.innings.some((inn) => inn.bat.length > 0);
      if (!hasScorecard) continue;

      // Upsert teams from match detail
      await upsertTeamFromMatch(
        db,
        {
          id: detail.home_team_id,
          name: detail.home_team_name,
          clubId: detail.home_club_id,
        },
        siteId,
      );
      await upsertTeamFromMatch(
        db,
        {
          id: detail.away_team_id,
          name: detail.away_team_name,
          clubId: detail.away_club_id,
        },
        siteId,
      );

      // Determine which teams are ours
      const ourTeamIds = new Set<string>();
      if (match.home_club_id === siteId) ourTeamIds.add(match.home_team_id);
      if (match.away_club_id === siteId) ourTeamIds.add(match.away_team_id);

      // Build keeper lookup
      const homeKeeperIds = getWicketkeeperIds(detail.players, "home");
      const awayKeeperIds = getWicketkeeperIds(detail.players, "away");

      // "Standard" hardball or "Pairs" (Women's Softball). Drives the
      // unified scoring formula and decides whether to attempt fielding
      // attribution.
      const gameType = detail.game_type || "Standard";
      const dismissalPenalty = parseInt(detail.dismissal_penalty || "") || 0;
      const startingRuns = parseInt(detail.starting_runs || "");

      for (const innings of detail.innings) {
        const battingTeamId = innings.team_batting_id;
        const isBattingTeamOurs = ourTeamIds.has(battingTeamId);

        const fieldingTeamId =
          battingTeamId === match.home_team_id
            ? match.away_team_id
            : match.home_team_id;
        const isFieldingTeamOurs = ourTeamIds.has(fieldingTeamId);

        const fieldingKeeperIds =
          fieldingTeamId === match.home_team_id ? homeKeeperIds : awayKeeperIds;

        if (isBattingTeamOurs) {
          await storeBattingPerformances(
            db,
            innings.bat,
            matchId,
            battingTeamId,
            match.competition_type ?? "",
            matchDateIso,
            season,
            gameType,
            dismissalPenalty,
          );
        }

        if (isFieldingTeamOurs) {
          await storeBowlingPerformances(
            db,
            innings.bowl,
            matchId,
            fieldingTeamId,
            match.competition_type ?? "",
            matchDateIso,
            season,
            gameType,
          );

          // Pairs scorecards don't carry per-dismissal fielder attribution
          // (how_out is null for every batter), so we can't credit catches /
          // run-outs / stumpings to individuals. Skip rather than write zero
          // rows that would shadow real attribution from any future format.
          if (gameType !== "Pairs") {
            const fieldingCredits = extractFieldingCredits(
              innings.bat,
              fieldingKeeperIds,
            );
            await storeFieldingPerformances(
              db,
              fieldingCredits,
              matchId,
              fieldingTeamId,
              match.competition_type ?? "",
              matchDateIso,
              season,
              gameType,
            );
          }
        }
      }

      // Store match result with cutoff logic
      const matchResult = (detail.result ?? "").trim();
      const isRecent = matchDate > resultCutoff;
      const shouldWriteResult = matchResult || !isRecent;

      if (shouldWriteResult) {
        const startingRunsForResult = Number.isFinite(startingRuns)
          ? startingRuns
          : null;
        const dismissalPenaltyForResult =
          gameType === "Pairs" ? dismissalPenalty : null;

        await db
          .insertInto("match_result")
          .values({
            id: crypto.randomUUID(),
            match_id: matchId,
            home_team_id: detail.home_team_id,
            away_team_id: detail.away_team_id,
            home_team_name: detail.home_team_name,
            away_team_name: detail.away_team_name,
            // Source club fields from the summary, not the detail payload —
            // the detail schema makes club_id optional with "" default and
            // we'd rather store NULL than an empty string that breaks the
            // launcher's club_id = siteId filter.
            home_club_id: match.home_club_id,
            home_club_name: match.home_club_name,
            away_club_id: match.away_club_id,
            away_club_name: match.away_club_name,
            result: matchResult,
            result_description: detail.result_description ?? "",
            result_applied_to: detail.result_applied_to ?? "",
            competition_type: match.competition_type ?? "",
            match_date: matchDateIso,
            season,
            game_type: gameType,
            starting_runs: startingRunsForResult,
            dismissal_penalty: dismissalPenaltyForResult,
          })
          .onConflict((oc) =>
            oc.column("match_id").doUpdateSet({
              result: matchResult,
              result_description: detail.result_description ?? "",
              result_applied_to: detail.result_applied_to ?? "",
              match_date: matchDateIso,
              home_club_id: match.home_club_id,
              home_club_name: match.home_club_name,
              away_club_id: match.away_club_id,
              away_club_name: match.away_club_name,
              game_type: gameType,
              starting_runs: startingRunsForResult,
              dismissal_penalty: dismissalPenaltyForResult,
            }),
          )
          .execute();
      }

      // ResultsVault ball-by-ball + match-stream ingest. Independent of
      // the PC sync above; failures (token rejection, schema drift, RV
      // outage) are logged but never propagated. The "match has no RV
      // data" case is the common one and resolves silently inside
      // ingestRvDataForMatch.
      //
      // Gate on `shouldWriteResult` — otherwise we'd run the ingest for
      // a recent match whose match_result row was deliberately skipped
      // (no result entered yet, isRecent=true). match_ball / match_stream
      // both FK to match_result.match_id, so writing them now would FK-
      // violate. The next sync within the resync window picks the match
      // up once the result lands.
      if (rv && shouldWriteResult) {
        try {
          await ingestRvDataForMatch(db, rv, matchId, matchDateIso, log);
        } catch (rvErr) {
          // Log via Pino so the stack + cause survive (the array push
          // stringifies and loses both — kept for the DB log row).
          log.error(
            { err: rvErr, matchId },
            "play_cricket_sync_rv_ingest_failed",
          );
          errors.push(
            `RV ingest failed for match ${matchId}: ${
              rvErr instanceof Error ? rvErr.message : String(rvErr)
            }`,
          );
        }
      }

      matchesProcessed++;
    } catch (err) {
      log.error({ err, matchId }, "play_cricket_sync_match_failed");
      const msg = `Error processing match ${matchId}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
    }
  }

  return { matchesProcessed, errors };
}

// --- Public API ---

/**
 * Run a full Play-Cricket stats sync.
 *
 * Follows the curried factory pattern: `runSync(db, api)` returns an async
 * function that accepts sync config and performs the sync.
 */
export function runSync(
  db: Kysely<DB>,
  api: PlayCricketApiClient,
  rv: RvClient | null = null,
  log: FastifyBaseLogger,
) {
  return async (config: SyncConfig): Promise<SyncResult> => {
    const logId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      const result = await syncMatches(db, api, rv, config, startTime, log);

      // Log the sync
      await db
        .insertInto("play_cricket_sync_log")
        .values({
          id: logId,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          season: new Date().getFullYear(),
          matches_processed: result.matchesProcessed,
          errors:
            result.errors.length > 0 ? JSON.stringify(result.errors) : null,
        })
        .execute();

      // Recompute fantasy scores for the current season every run.
      // Idempotent (upserts), so harmless when nothing's changed; also picks up
      // scoring-rule edits, chip changes, and corrected results between matches.
      // Non-fatal: scoring failures are logged but don't fail the sync.
      try {
        const season = String(new Date().getFullYear());
        await calculateFantasyScores(db)(season);
      } catch (scoringErr) {
        // Log via Pino so the stack survives — the array push
        // String()s the error and loses the trace.
        log.error(
          { err: scoringErr },
          "play_cricket_sync_fantasy_scoring_failed",
        );
        result.errors.push(
          `Fantasy scoring failed: ${
            scoringErr instanceof Error
              ? scoringErr.message
              : String(scoringErr)
          }`,
        );
      }

      return result;
    } catch (err) {
      // Top-level sync failure. Log via Pino BEFORE the DB write so
      // the breadcrumb survives even if the DB itself is the cause
      // of the failure.
      log.error({ err }, "play_cricket_sync_failed");

      try {
        await db
          .insertInto("play_cricket_sync_log")
          .values({
            id: logId,
            started_at: startedAt,
            completed_at: new Date().toISOString(),
            season: new Date().getFullYear(),
            matches_processed: 0,
            errors: JSON.stringify([
              err instanceof Error ? err.message : String(err),
            ]),
          })
          .execute();
      } catch (logErr) {
        // The DB write itself failed. Surface it instead of swallowing
        // — without this, an outage that takes down both the sync and
        // the log table is invisible.
        log.error(
          { err: logErr, originalErr: err },
          "play_cricket_sync_log_write_failed",
        );
      }

      throw err;
    }
  };
}
