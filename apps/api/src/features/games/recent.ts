import type { FastifyBaseLogger } from "fastify";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import type {
  LiveMatchDetail,
  ResultSummaryMatch,
} from "../play-cricket/api-schemas.ts";
import {
  fetchMatchSummaries,
  parseMatchDateTime,
  resolveOutcome,
  type MatchSummary,
  type Outcome,
} from "./service.ts";

// The homepage scoreboard: the club's most recent results, with any game
// that is in play right now shown live. Everything here reads Play Cricket
// directly (result_summary.json + match_detail.json) rather than the
// DB match_result rows, because those only refresh on the weekly sync -
// far too stale for a "latest scores" strip.
//
// Unlike other services this one takes no `db`: every displayed fact comes
// from Play Cricket. Games whose result exists only as a manual matchday
// entry (no PC scorecard) don't appear here; they still show on the
// calendar pages, which merge DB results.

// --- Types ---

export interface RecentGameInnings {
  teamBattingId: string;
  teamName: string;
  runs: number;
  wickets: number;
  overs: string;
  declared: boolean;
  allOut: boolean;
}

export interface RecentGameItem {
  id: string;
  status: "live" | "result";
  when: string | null;
  home: boolean;
  team: { id: string; name: string };
  opposition: {
    club: { id: string; name: string };
    team: { id: string; name: string };
  };
  league: { id: string; name: string };
  competition: { id: string; name: string; type: string };
  outcome: Outcome | null;
  /** "Won by 5 wickets", "Mitford CC need 74 more to win", "In play", ... */
  note: string | null;
  /** Batting order preserved. Empty while nothing has been scored. */
  innings: RecentGameInnings[];
}

export interface RecentGamesResult {
  items: RecentGameItem[];
  hasLive: boolean;
}

// --- Tunables ---

const MAX_ITEMS = 3;
/** Cap match_detail lookups per request; candidates beyond this many
 * simultaneous same-day games are (senior teams first) simply skipped. */
const MAX_LIVE_LOOKUPS = 4;
/** A scheduled game with no scores yet stays "in play" for this long after
 * its start time, then drops off (rained-off games never post scores). */
const IN_PLAY_WINDOW_MINUTES = 8 * 60;
const RESULTS_TTL_MS = 5 * 60_000;
const LIVE_DETAIL_TTL_MS = 60_000;

// --- London wall-clock helpers ---
//
// Play Cricket serves dates (DD/MM/YYYY) and times (HH:mm) in UK local
// time with no zone marker. Rather than converting to UTC instants (which
// needs a tz database), all "is this game on right now?" comparisons happen
// in London wall-clock terms via Intl.

export interface LondonNow {
  /** DD/MM/YYYY, matching Play Cricket's match_date format. */
  datePc: string;
  /** Minutes since local midnight. */
  minutes: number;
  year: number;
}

export function londonNow(now: Date): LondonNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    datePc: `${get("day")}/${get("month")}/${get("year")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    year: Number(get("year")),
  };
}

/** "13:00" -> 780; null for missing/malformed times. */
export function parseTimeToMinutes(time: string | null | undefined) {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** DD/MM/YYYY + HH:mm -> sortable "YYYY-MM-DDTHH:mm"; null if malformed. */
function pcSortKey(matchDate: string, matchTime: string): string | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(matchDate)) return null;
  const [dd, mm, yyyy] = matchDate.split("/");
  const time = /^\d{2}:\d{2}$/.test(matchTime) ? matchTime : "00:00";
  return `${yyyy}-${mm}-${dd}T${time}`;
}

// Mirrors the homepage UpcomingStrip ordering: senior XIs lead when several
// games are on at once.
function teamPriority(teamName: string): number {
  if (/1st/i.test(teamName)) return 2;
  if (/2nd/i.test(teamName)) return 1;
  return 0;
}

// --- Innings + note building ---

function toInnings(
  raw: Array<{
    team_batting_id: string;
    runs: string;
    wickets: string;
    overs: string;
    declared: boolean | null;
  }>,
  teamNameById: Map<string, string>,
): RecentGameInnings[] {
  return raw
    .filter((inn) => inn.runs !== "" || inn.overs !== "")
    .map((inn) => {
      const runs = parseInt(inn.runs) || 0;
      const wickets = parseInt(inn.wickets) || 0;
      return {
        teamBattingId: inn.team_batting_id,
        teamName: teamNameById.get(inn.team_batting_id) ?? "",
        runs,
        wickets,
        overs: inn.overs,
        declared: inn.declared ?? false,
        allOut: wickets >= 10,
      };
    });
}

/**
 * Margin text from the winner's side of a completed two-innings game,
 * phrased from Percy Main's perspective ("Won by 43 runs"). Returns null
 * whenever the margin can't be derived safely (Pairs scoring, multi-innings
 * games, missing data) - the outcome stamp still tells the story.
 */
export function buildResultNote(
  outcome: Outcome | null,
  gameType: string,
  innings: RecentGameInnings[],
  winnerTeamId: string,
): string | null {
  switch (outcome) {
    case "A":
      return "Abandoned";
    case "C":
      return "Cancelled";
    case "N":
      return "No result";
    case "D":
      return "Match drawn";
    case "T":
      return "Match tied";
    case null:
      return null;
    default:
      break;
  }

  if (gameType !== "Standard" || innings.length !== 2 || !winnerTeamId) {
    return null;
  }
  const verb = outcome === "W" ? "Won" : "Lost";
  const [first, second] = innings;
  if (second.teamBattingId === winnerTeamId) {
    const wickets = 10 - second.wickets;
    if (wickets > 0 && wickets <= 10) {
      return `${verb} by ${String(wickets)} wicket${wickets === 1 ? "" : "s"}`;
    }
    return null;
  }
  if (first.teamBattingId === winnerTeamId) {
    const runs = first.runs - second.runs;
    if (runs > 0) {
      return `${verb} by ${String(runs)} run${runs === 1 ? "" : "s"}`;
    }
  }
  return null;
}

function buildLiveNote(
  innings: RecentGameInnings[],
  gameType: string,
): string | null {
  if (innings.length === 0) return "In play";
  if (innings.length === 1) return "First innings in progress";
  if (innings.length === 2 && gameType === "Standard") {
    const [first, second] = innings;
    const need = first.runs + 1 - second.runs;
    if (need > 0 && second.teamName) {
      return `${second.teamName} need ${String(need)} more to win`;
    }
  }
  return "In play";
}

// --- Item builders ---

function buildResultItem(
  row: ResultSummaryMatch,
  siteId: string,
): RecentGameItem {
  const home = row.home_club_id === siteId;
  const ourTeamId = home ? row.home_team_id : row.away_team_id;
  const teamNameById = new Map([
    [row.home_team_id, row.home_club_name],
    [row.away_team_id, row.away_club_name],
  ]);
  const innings = toInnings(row.innings, teamNameById);
  const outcome = resolveOutcome(
    row.result,
    row.result_applied_to,
    row.result_description,
    ourTeamId,
  );

  return {
    id: String(row.id),
    status: "result",
    when: parseMatchDateTime(row.match_date, row.match_time || null),
    home,
    team: {
      id: ourTeamId,
      name: home ? row.home_team_name : row.away_team_name,
    },
    opposition: home
      ? {
          club: { id: row.away_club_id, name: row.away_club_name },
          team: { id: row.away_team_id, name: row.away_team_name },
        }
      : {
          club: { id: row.home_club_id, name: row.home_club_name },
          team: { id: row.home_team_id, name: row.home_team_name },
        },
    league: { id: row.league_id, name: row.league_name },
    competition: {
      id: row.competition_id,
      name: row.competition_name,
      type: row.competition_type,
    },
    outcome,
    note: buildResultNote(
      outcome,
      row.game_type,
      innings,
      row.result_applied_to,
    ),
    innings,
  };
}

function detailTeamNames(detail: LiveMatchDetail): Map<string, string> {
  return new Map([
    [detail.home_team_id, detail.home_club_name],
    [detail.away_team_id, detail.away_club_name],
  ]);
}

function buildLiveItem(
  match: MatchSummary,
  detail: LiveMatchDetail | null,
): RecentGameItem {
  const innings = detail
    ? toInnings(detail.innings, detailTeamNames(detail))
    : [];
  return {
    id: match.id,
    status: "live",
    when: parseMatchDateTime(match.matchDate, match.matchTime),
    home: match.home,
    team: match.team,
    opposition: match.opposition,
    league: match.league,
    competition: match.competition,
    outcome: null,
    note: buildLiveNote(innings, detail?.game_type ?? ""),
    innings,
  };
}

/** A candidate that turned out to have finished - Play Cricket's
 * result_summary usually lags the detail endpoint by a few minutes, so
 * synthesise the result item from the detail we already fetched. */
function buildJustFinishedItem(
  match: MatchSummary,
  detail: LiveMatchDetail,
): RecentGameItem {
  const innings = toInnings(detail.innings, detailTeamNames(detail));
  const outcome = resolveOutcome(
    detail.result,
    detail.result_applied_to,
    detail.result_description,
    match.team.id,
  );
  return {
    id: match.id,
    status: "result",
    when: parseMatchDateTime(match.matchDate, match.matchTime),
    home: match.home,
    team: match.team,
    opposition: match.opposition,
    league: match.league,
    competition: match.competition,
    outcome,
    note: buildResultNote(
      outcome,
      detail.game_type,
      innings,
      detail.result_applied_to,
    ),
    innings,
  };
}

// --- Service factory ---

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

/**
 * Curried factory (one instance per route registration; the closures are
 * this process's caches). No `db` parameter by design - see module header.
 */
export function listRecentGames(api: PlayCricketApiClient, siteId: string) {
  let resultsCache:
    (CacheEntry<ResultSummaryMatch[]> & { season: number }) | null = null;
  const liveDetailCache = new Map<string, CacheEntry<LiveMatchDetail | null>>();

  async function getResults(
    season: number,
    log: FastifyBaseLogger,
  ): Promise<ResultSummaryMatch[]> {
    if (
      resultsCache?.season === season &&
      Date.now() - resultsCache.fetchedAt < RESULTS_TTL_MS
    ) {
      return resultsCache.data;
    }
    try {
      const response = await api.getResultSummary(season);
      resultsCache = {
        data: response.result_summary,
        fetchedAt: Date.now(),
        season,
      };
      return response.result_summary;
    } catch (err) {
      log.warn({ err }, "play_cricket_result_summary_unavailable");
      // Stale results beat an empty homepage section.
      if (resultsCache?.season === season) {
        return resultsCache.data;
      }
      return [];
    }
  }

  async function getLiveDetail(
    matchId: string,
    log: FastifyBaseLogger,
  ): Promise<LiveMatchDetail | null> {
    const cached = liveDetailCache.get(matchId);
    if (cached && Date.now() - cached.fetchedAt < LIVE_DETAIL_TTL_MS) {
      return cached.data;
    }
    try {
      const response = await api.getLiveMatchDetail(matchId);
      const detail = response.match_details[0] ?? null;
      liveDetailCache.set(matchId, { data: detail, fetchedAt: Date.now() });
      return detail;
    } catch (err) {
      log.warn({ err, matchId }, "play_cricket_live_detail_unavailable");
      // Serve stale if present; otherwise the card degrades to scoreless.
      return cached?.data ?? null;
    }
  }

  return async (
    log: FastifyBaseLogger,
    now = new Date(),
  ): Promise<RecentGamesResult> => {
    const today = londonNow(now);
    const season = today.year;

    const [summaries, results] = await Promise.all([
      fetchMatchSummaries(api, siteId, season).catch((err: unknown) => {
        log.warn({ err }, "play_cricket_matches_summary_unavailable");
        return [] as MatchSummary[];
      }),
      getResults(season, log),
    ]);

    const resultedIds = new Set(
      results.filter((row) => row.result !== "").map((row) => String(row.id)),
    );

    // Same-day games that have started and have no posted result yet.
    const candidates = summaries
      .map((match) => ({
        match,
        startMinutes: parseTimeToMinutes(match.matchTime),
      }))
      .filter(
        (c): c is { match: MatchSummary; startMinutes: number } =>
          c.match.matchDate === today.datePc &&
          !resultedIds.has(c.match.id) &&
          c.startMinutes !== null &&
          today.minutes >= c.startMinutes,
      )
      .sort(
        (a, b) =>
          teamPriority(b.match.team.name) - teamPriority(a.match.team.name) ||
          a.startMinutes - b.startMinutes,
      )
      .slice(0, MAX_LIVE_LOOKUPS);

    const liveItems: RecentGameItem[] = [];
    const justFinished: RecentGameItem[] = [];
    for (const { match, startMinutes } of candidates) {
      const detail = await getLiveDetail(match.id, log);
      if (detail && detail.result_description !== "") {
        justFinished.push(buildJustFinishedItem(match, detail));
        continue;
      }
      const item = buildLiveItem(match, detail);
      const elapsed = today.minutes - startMinutes;
      if (item.innings.length === 0 && elapsed > IN_PLAY_WINDOW_MINUTES) {
        continue;
      }
      liveItems.push(item);
    }

    // Just-finished games merge into the completed results and share their
    // newest-first ordering (by start datetime) rather than being pinned to
    // the front - a morning game confirmed via match_detail must not
    // outrank an evening result that already reached result_summary.
    const finishedIds = new Set(justFinished.map((item) => item.id));
    const resultItems = results
      .filter((row) => row.result !== "" && !finishedIds.has(String(row.id)))
      .map((row) => ({
        row,
        sortKey: pcSortKey(row.match_date, row.match_time),
      }))
      .filter(
        (entry): entry is { row: ResultSummaryMatch; sortKey: string } =>
          entry.sortKey !== null,
      )
      .map((entry) => buildResultItem(entry.row, siteId));

    const allResults = [...justFinished, ...resultItems].sort((a, b) =>
      (b.when ?? "").localeCompare(a.when ?? ""),
    );

    const items = [...liveItems, ...allResults].slice(0, MAX_ITEMS);
    return { items, hasLive: liveItems.length > 0 };
  };
}
