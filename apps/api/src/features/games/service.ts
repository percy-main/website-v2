import type { DB } from "@percy-main/db";
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
    innings: Array<{
      teamBattingId: string;
      teamName: string;
      runs: number;
      wickets: number;
      overs: string;
      declared: boolean;
      allOut: boolean;
    }>;
  } | null;
  sponsor: {
    name: string;
    logoUrl: string | null;
    message: string | null;
    website: string | null;
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
  return async (matchId: string): Promise<GameDetail | null> => {
    // Fetch match detail, DB data, and sponsorship in parallel
    // Match detail is the primary source — no season search needed
    const [matchDetail, dbResult, sponsorship, manualResult] =
      await Promise.all([
        api.getMatchDetail(matchId).catch(() => null),
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
          ])
          .executeTakeFirst(),
        db
          .selectFrom("matchday")
          .where("play_cricket_match_id", "=", matchId)
          .where("result_type", "is not", null)
          .select(["result_type", "result_source"])
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
        };
      });

      result = {
        outcome,
        description: detail.result_description ?? "",
        toss: detail.toss ?? "",
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
          }
        : null,
    };
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
