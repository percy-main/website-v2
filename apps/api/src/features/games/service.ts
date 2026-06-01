import type { DB } from "@percy-main/db";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";

// --- In-memory cache for match summaries ---

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const summaryCache = new Map<number, CacheEntry<MatchSummary[]>>();
const SUMMARY_TTL_MS = 30 * 60 * 1000; // 30 minutes

// --- Types ---

export interface MatchSummary {
  id: string;
  matchDate: string;
  matchTime: string | null;
  home: boolean;
  team: { id: string; name: string };
  opposition: {
    club: { id: string; name: string };
    team: { id: string; name: string };
  };
  league: { id: string; name: string };
  competition: { id: string; name: string; type: string };
  groundName: string | null;
}

export type Outcome = "W" | "L" | "D" | "T" | "A" | "C" | "N";

export interface GameListItem extends MatchSummary {
  when: string | null;
  outcome: Outcome | null;
  scoreDescription: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
}

export interface GameDetail extends GameListItem {
  location: {
    name: string;
    street?: string;
    city?: string;
    postcode?: string;
    county?: string;
    country?: string;
  } | null;
  result: {
    outcome: Outcome | null;
    description: string;
    toss: string;
    gameType: string;
    innings: Array<{
      teamBattingId: string;
      teamName: string;
      runs: number;
      wickets: number;
      overs: string;
      declared: boolean;
      allOut: boolean;
      netScore: number | null;
    }>;
  } | null;
  sponsor: {
    name: string;
    logoUrl: string | null;
    message: string | null;
    website: string | null;
    phone: string | null;
  } | null;
  lineup: {
    confirmed: boolean;
    matchdayId: string;
    players: Array<{ name: string }>;
  } | null;
  // Non-null while an availability_request covers this fixture. When
  // status is "open" the FE swaps the "Pick team" CTA for a link into
  // the selection picker, where an official confirms this fixture's team
  // to create its matchday (see confirmFixture) without closing the
  // whole request. Closing the request also materialises any still-open
  // fixtures (see updateRequestStatus). Creating one directly here would
  // race the selection and is forbidden by createMatchday.
  availabilityRequest: {
    id: string;
    status: string;
    date: string;
  } | null;
}

// --- Helpers ---

function resolveOutcome(
  result: string,
  resultAppliedTo: string,
  resultDescription: string,
  ourTeamId: string,
): Outcome | null {
  if (!result || result === "") return null;

  const desc = resultDescription.toLowerCase();
  if (desc.includes("abandoned")) return "A";
  if (desc.includes("cancel")) return "C";
  if (desc.includes("tied") || result === "T") return "T";
  if (desc.includes("draw") || result === "D") return "D";
  if (desc.includes("no result")) return "N";

  if (result === "W") {
    if (!resultAppliedTo) return null;
    return resultAppliedTo === ourTeamId ? "W" : "L";
  }

  return null;
}

function parseMatchDateTime(
  matchDate: string,
  matchTime: string | null,
): string | null {
  // matchDate is DD/MM/YYYY
  if (!matchDate || !/^\d{2}\/\d{2}\/\d{4}$/.test(matchDate)) return null;
  const [dd, mm, yyyy] = matchDate.split("/");
  const datePart = `${yyyy}-${mm}-${dd}`;
  if (matchTime) {
    return `${datePart}T${matchTime}:00`;
  }
  return `${datePart}T00:00:00`;
}

function buildScoreDescription(
  innings: Array<{
    runs: number;
    wickets: number;
    allOut: boolean;
    declared: boolean;
  }>,
): string {
  if (!innings || innings.length === 0) return "";
  return innings
    .map((inn) => {
      const wicketStr = inn.allOut ? "" : `/${inn.wickets}`;
      const declStr = inn.declared ? "d" : "";
      return `${inn.runs}${wicketStr}${declStr}`;
    })
    .join(" – ");
}

// --- Service factories ---

export function listGames(
  db: Kysely<DB>,
  api: PlayCricketApiClient,
  siteId: string,
) {
  return async (season: number): Promise<GameListItem[]> => {
    // Fetch match summaries (cached)
    const matches = await fetchMatchSummaries(api, siteId, season);

    if (matches.length === 0) return [];

    const matchIds = matches.map((m) => m.id);

    // Fetch results, sponsorships, and manual results from DB in parallel
    const [results, sponsorships, manualResults] = await Promise.all([
      db
        .selectFrom("match_result")
        .where("match_id", "in", matchIds)
        .selectAll()
        .execute(),
      db
        .selectFrom("game_sponsorship")
        .where("game_id", "in", matchIds)
        .where("approved", "=", true)
        .where("paid_at", "is not", null)
        .select([
          "game_id",
          "sponsor_name",
          "display_name",
          "sponsor_logo_url",
          "sponsor_message",
          "sponsor_website",
        ])
        .execute(),
      db
        .selectFrom("matchday")
        .where("play_cricket_match_id", "in", matchIds)
        .where("result_type", "is not", null)
        .select(["play_cricket_match_id", "result_type"])
        .execute(),
    ]);

    const resultsByMatchId = new Map(results.map((r) => [r.match_id, r]));
    const sponsorsByMatchId = new Map(sponsorships.map((s) => [s.game_id, s]));
    const manualByMatchId = new Map(
      manualResults.map((m) => [m.play_cricket_match_id, m]),
    );

    return matches.map((match) => {
      const result = resultsByMatchId.get(match.id);
      const sponsor = sponsorsByMatchId.get(match.id);

      let outcome: Outcome | null = null;
      let scoreDescription: string | null = null;

      if (result) {
        // Play Cricket is the primary source of truth
        outcome = resolveOutcome(
          result.result,
          result.result_applied_to,
          result.result_description,
          match.team.id,
        );

        scoreDescription = result.result_description || null;
      }

      // No Play Cricket result — use manual official result if available
      if (!outcome) {
        const manual = manualByMatchId.get(match.id);
        if (manual?.result_type) {
          outcome = manual.result_type as Outcome;
        }
      }

      return {
        ...match,
        when: parseMatchDateTime(match.matchDate, match.matchTime),
        outcome,
        scoreDescription,
        sponsorName: sponsor
          ? (sponsor.display_name ?? sponsor.sponsor_name)
          : null,
        sponsorLogoUrl: sponsor?.sponsor_logo_url ?? null,
      };
    });
  };
}

export function getGame(
  db: Kysely<DB>,
  api: PlayCricketApiClient,
  siteId: string,
) {
  return async (
    matchId: string,
    log: FastifyBaseLogger,
  ): Promise<GameDetail | null> => {
    // Fetch match detail, DB data, and sponsorship in parallel
    // Match detail is the primary source — no season search needed
    const [
      matchDetail,
      dbResult,
      sponsorship,
      manualResult,
      confirmedMatchday,
      availabilityRequest,
    ] = await Promise.all([
      api.getMatchDetail(matchId).catch((err: unknown) => {
        // Continue with degraded behaviour but log so a PC outage
        // can be detected via the warn rate.
        log.warn({ err, matchId }, "play_cricket_match_detail_unavailable");
        return null;
      }),
      db
        .selectFrom("match_result")
        .where("match_id", "=", matchId)
        .selectAll()
        .executeTakeFirst(),
      db
        .selectFrom("game_sponsorship")
        .where("game_id", "=", matchId)
        .where("approved", "=", true)
        .where("paid_at", "is not", null)
        .select([
          "sponsor_name",
          "display_name",
          "sponsor_logo_url",
          "sponsor_message",
          "sponsor_website",
          "sponsor_phone",
        ])
        .executeTakeFirst(),
      db
        .selectFrom("matchday")
        .where("play_cricket_match_id", "=", matchId)
        .where("result_type", "is not", null)
        .select(["result_type", "result_source"])
        .executeTakeFirst(),
      db
        .selectFrom("matchday")
        .where("play_cricket_match_id", "=", matchId)
        .select(["id", "confirmed_at"])
        .executeTakeFirst(),
      db
        .selectFrom("availability_fixture")
        .innerJoin(
          "availability_request",
          "availability_request.id",
          "availability_fixture.availability_request_id",
        )
        .where("availability_fixture.play_cricket_match_id", "=", matchId)
        .select([
          "availability_request.id",
          "availability_request.status",
          "availability_fixture.match_date as date",
        ])
        .orderBy("availability_request.created_at", "desc")
        .limit(1)
        .executeTakeFirst(),
    ]);

    const detail = matchDetail?.match_details[0];
    if (!detail) return null;

    const home = detail.home_club_id === siteId;
    const ourTeamId = home ? detail.home_team_id : detail.away_team_id;

    // Try to enrich from cached summary (has league, competition, ground, match_time)
    let matchSummary: MatchSummary | undefined;
    const season = detail.season ? parseInt(detail.season) : null;
    if (season) {
      const cached = summaryCache.get(season);
      if (cached && Date.now() - cached.fetchedAt < SUMMARY_TTL_MS) {
        matchSummary = cached.data.find((m) => m.id === matchId);
      }
    }

    let outcome: Outcome | null = null;
    let result: GameDetail["result"] = null;

    if (dbResult) {
      outcome = resolveOutcome(
        dbResult.result,
        dbResult.result_applied_to,
        dbResult.result_description,
        ourTeamId,
      );
    }

    // Fall back to manual result from matchday if Play Cricket has no outcome
    if (!outcome && manualResult?.result_type) {
      outcome = manualResult.result_type as Outcome;
    }

    if (detail.innings.some((inn) => inn.bat.length > 0)) {
      const gameType = detail.game_type || "Standard";
      const startingRuns = parseInt(detail.starting_runs || "");
      const dismissalPenalty = parseInt(detail.dismissal_penalty || "");
      const hasNetScore =
        gameType === "Pairs" &&
        Number.isFinite(startingRuns) &&
        Number.isFinite(dismissalPenalty);

      const innings = detail.innings.map((inn) => {
        const isHome = inn.team_batting_id === detail.home_team_id;
        const teamName = isHome
          ? `${detail.home_club_name} ${detail.home_team_name}`
          : `${detail.away_club_name} ${detail.away_team_name}`;
        const runs = parseInt(inn.runs) || 0;
        const wickets = parseInt(inn.wickets) || 0;

        return {
          teamBattingId: inn.team_batting_id,
          teamName,
          runs,
          wickets,
          overs: inn.overs,
          declared: inn.declared ?? false,
          allOut: wickets >= 10,
          // Play Cricket's "Net Score" for Pairs games. Hardball innings
          // get null and the UI hides the column.
          netScore: hasNetScore
            ? startingRuns + runs - wickets * dismissalPenalty
            : null,
        };
      });

      result = {
        outcome,
        description: detail.result_description ?? "",
        toss: detail.toss ?? "",
        gameType,
        innings,
      };
    }

    const location = home
      ? {
          name: "Percy Main Cricket and Sports Club",
          street: "St Johns Terrace",
          city: "North Shields",
          postcode: "NE29 6HS",
          county: "Tyne and Wear",
          country: "United Kingdom",
        }
      : matchSummary?.groundName
        ? { name: matchSummary.groundName }
        : null;

    // Build lineup if a matchday exists with selected or playing players
    let lineup: GameDetail["lineup"] = null;
    if (confirmedMatchday) {
      const players = await db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", confirmedMatchday.id)
        .where("status", "in", ["selected", "playing"])
        .select(["player_name"])
        .orderBy("created_at", "asc")
        .execute();

      lineup = {
        confirmed: confirmedMatchday.confirmed_at !== null,
        matchdayId: confirmedMatchday.id,
        players: players.map((p) => ({ name: p.player_name })),
      };
    }

    // Build summary from match detail, enriching with cached summary where available
    const matchDate = detail.match_date ?? matchSummary?.matchDate ?? "";
    const matchTime = matchSummary?.matchTime ?? null;

    return {
      id: matchId,
      matchDate,
      matchTime,
      home,
      team: matchSummary?.team ?? {
        id: ourTeamId,
        name: home ? detail.home_team_name : detail.away_team_name,
      },
      opposition: matchSummary?.opposition ?? {
        club: {
          id: home ? (detail.away_club_id ?? "") : (detail.home_club_id ?? ""),
          name: home ? detail.away_club_name : detail.home_club_name,
        },
        team: {
          id: home ? detail.away_team_id : detail.home_team_id,
          name: home ? detail.away_team_name : detail.home_team_name,
        },
      },
      league: matchSummary?.league ?? { id: "", name: "" },
      competition: matchSummary?.competition ?? {
        id: "",
        name: "",
        type: detail.competition_type ?? "",
      },
      groundName: matchSummary?.groundName ?? null,
      when: parseMatchDateTime(matchDate, matchTime),
      outcome,
      scoreDescription: result ? buildScoreDescription(result.innings) : null,
      sponsorName: sponsorship
        ? (sponsorship.display_name ?? sponsorship.sponsor_name)
        : null,
      sponsorLogoUrl: sponsorship?.sponsor_logo_url ?? null,
      location,
      result,
      sponsor: sponsorship
        ? {
            name: sponsorship.display_name ?? sponsorship.sponsor_name,
            logoUrl: sponsorship.sponsor_logo_url,
            message: sponsorship.sponsor_message,
            website: sponsorship.sponsor_website,
            phone: sponsorship.sponsor_phone,
          }
        : null,
      lineup,
      availabilityRequest: availabilityRequest
        ? {
            id: availabilityRequest.id,
            status: availabilityRequest.status,
            date: availabilityRequest.date,
          }
        : null,
    };
  };
}

// --- Wagon wheel ---

export interface WagonWheelBall {
  over: number;
  ball: number;
  ballDisp: number;
  batterRvId: number | null;
  batterName: string | null;
  bowlerRvId: number | null;
  bowlerName: string | null;
  dismissed: boolean;
  runsBat: number;
  runsExtra: number;
  extrasType: string | null;
  lDesc: string;
  sDesc: string;
  shotAngle: number | null;
  shotLength: number | null;
}

export interface WagonWheelInnings {
  inningsNumber: number;
  balls: WagonWheelBall[];
}

export interface WagonWheelData {
  matchId: string;
  // Runs deducted per dismissal — 0 for hardball, configured per Pairs
  // match (typically 5). Stored once on match_result; consumers apply it
  // when computing net scores or rendering cumulative charts.
  dismissalPenalty: number;
  innings: WagonWheelInnings[];
}

export function getWagonWheel(db: Kysely<DB>) {
  return async (matchId: string): Promise<WagonWheelData> => {
    const [matchResult, rows] = await Promise.all([
      db
        .selectFrom("match_result")
        .where("match_id", "=", matchId)
        .select(["dismissal_penalty"])
        .executeTakeFirst(),
      db
        .selectFrom("match_ball")
        .leftJoin(
          "rv_player_mapping as batter",
          "batter.rv_player_id",
          "match_ball.batter_rv_id",
        )
        .leftJoin(
          "rv_player_mapping as bowler",
          "bowler.rv_player_id",
          "match_ball.bowler_rv_id",
        )
        .where("match_ball.match_id", "=", matchId)
        .select([
          "match_ball.rv_result_id",
          "match_ball.innings_number",
          "match_ball.over_no",
          "match_ball.ball_no",
          "match_ball.ball_no_disp",
          "match_ball.batter_rv_id",
          "match_ball.bowler_rv_id",
          "match_ball.dismissed_batter_rv_id",
          "match_ball.runs_bat",
          "match_ball.runs_extra",
          "match_ball.extras_type",
          "match_ball.l_desc",
          "match_ball.s_desc",
          "match_ball.shot_angle",
          "match_ball.shot_length",
          "batter.player_name as batter_name",
          "bowler.player_name as bowler_name",
        ])
        .orderBy("match_ball.rv_result_id", "asc")
        .orderBy("match_ball.over_no", "asc")
        .orderBy("match_ball.ball_no", "asc")
        .execute(),
    ]);

    const dismissalPenalty = matchResult?.dismissal_penalty ?? 0;

    // Group by rv_result_id. RV serves both teams' batting innings as
    // innings_number=1 in their respective team feeds, so innings_number
    // alone collapses both innings into one. rv_result_id is the canonical
    // per-innings discriminator. ball_time_utc is nullable and frequently
    // null for non-live-scored matches, so we order by (rv_result_id,
    // over_no, ball_no) for deterministic ordering without the risk of
    // null timestamps shuffling balls around.
    const byResult = new Map<string, WagonWheelBall[]>();
    for (const r of rows) {
      const ball: WagonWheelBall = {
        over: r.over_no,
        ball: r.ball_no,
        ballDisp: r.ball_no_disp,
        batterRvId: r.batter_rv_id,
        batterName: r.batter_name,
        bowlerRvId: r.bowler_rv_id,
        bowlerName: r.bowler_name,
        dismissed: r.dismissed_batter_rv_id !== null,
        runsBat: r.runs_bat,
        runsExtra: r.runs_extra,
        extrasType: r.extras_type,
        lDesc: r.l_desc,
        sDesc: r.s_desc,
        shotAngle: r.shot_angle,
        shotLength: r.shot_length,
      };
      const list = byResult.get(r.rv_result_id);
      if (list) list.push(ball);
      else byResult.set(r.rv_result_id, [ball]);
    }

    const innings: WagonWheelInnings[] = Array.from(byResult.entries()).map(
      ([, balls], idx) => ({ inningsNumber: idx + 1, balls }),
    );

    return { matchId, dismissalPenalty, innings };
  };
}

// --- Internal: cached fetch ---

async function fetchMatchSummaries(
  api: PlayCricketApiClient,
  siteId: string,
  season: number,
): Promise<MatchSummary[]> {
  const cached = summaryCache.get(season);
  if (cached && Date.now() - cached.fetchedAt < SUMMARY_TTL_MS) {
    return cached.data;
  }

  const response = await api.getMatchesSummary(season);

  const matches: MatchSummary[] = response.matches.map((match) => {
    const home = match.home_club_id === siteId;
    const team = home
      ? { id: match.home_team_id, name: match.home_team_name }
      : { id: match.away_team_id, name: match.away_team_name };
    const opposition = home
      ? {
          club: { id: match.away_club_id, name: match.away_club_name },
          team: { id: match.away_team_id, name: match.away_team_name },
        }
      : {
          club: { id: match.home_club_id, name: match.home_club_name },
          team: { id: match.home_team_id, name: match.home_team_name },
        };

    return {
      id: match.id.toString(),
      matchDate: match.match_date,
      matchTime: match.match_time ?? null,
      home,
      team,
      opposition,
      league: {
        id: match.league_id ?? "",
        name: match.league_name ?? "",
      },
      competition: {
        id: match.competition_id ?? "",
        name: match.competition_name ?? "",
        type: match.competition_type ?? "",
      },
      groundName: match.ground_name ?? null,
    };
  });

  summaryCache.set(season, { data: matches, fetchedAt: Date.now() });

  return matches;
}
