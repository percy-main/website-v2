import { tool } from "ai";
import { z } from "zod";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { ScoutCache } from "./cache.ts";

const HOUR = 60 * 60;

export interface PlayCricketToolDeps {
  playCricket: PlayCricketApiClient;
  cache: ScoutCache;
}

export function createPlayCricketTools(deps: PlayCricketToolDeps) {
  const { playCricket, cache } = deps;

  return {
    pc_list_players: tool({
      description:
        "List all players associated with Percy Main CC in Play Cricket. Returns names and play_cricket_ids — use these to look up local member records.",
      inputSchema: z.object({}),
      execute: async () =>
        cache.getOrSet("pc_list_players", {}, 24 * HOUR, () =>
          playCricket.getPlayers(),
        ),
    }),

    pc_match_summary: tool({
      description:
        "Fetch a season's worth of Percy Main CC match summaries (date, opposition, result, ground). Use this to find matches by opposition or date before drilling into a specific match.",
      inputSchema: z.object({
        season: z
          .number()
          .int()
          .describe(
            "Season year, e.g. 2025. Play Cricket seasons are calendar years.",
          ),
      }),
      execute: async ({ season }) =>
        cache.getOrSet("pc_match_summary", { season }, 6 * HOUR, () =>
          playCricket.getMatchesSummary(season),
        ),
    }),

    pc_match_detail: tool({
      description:
        "Fetch the full scorecard for a single match — both innings, batting & bowling figures, fall of wickets. Use after pc_match_summary to dig into a specific game.",
      inputSchema: z.object({
        matchId: z
          .string()
          .describe("Play Cricket match id from pc_match_summary."),
      }),
      execute: async ({ matchId }) =>
        cache.getOrSet("pc_match_detail", { matchId }, 24 * HOUR, () =>
          playCricket.getMatchDetail(matchId),
        ),
    }),

    pc_league_table: tool({
      description:
        "Fetch the current league table for a Play Cricket division. Returns positions, played, points. Use to gauge form/standing of an upcoming opposition.",
      inputSchema: z.object({
        divisionId: z
          .string()
          .describe(
            "Play Cricket division id. Often discoverable via match summaries.",
          ),
      }),
      execute: async ({ divisionId }) =>
        cache.getOrSet("pc_league_table", { divisionId }, 24 * HOUR, () =>
          playCricket.getLeagueTable(divisionId),
        ),
    }),

    pc_site_matches: tool({
      description: `Fetch a season's fixtures for ANY Play Cricket club using their site_id. THIS IS THE PRIMARY OPPOSITION-SCOUTING TOOL — it returns the opposition's matches against everyone, not only against Percy Main.

Important: in Play Cricket, "site_id" and "club_id" are the same number. Every match summary row carries home_club_id and away_club_id — those values can be passed directly here as siteId.

Workflow to scout an opponent:
  1. pc_match_summary(season) → find a Percy Main vs <Opposition> match.
  2. Read away_club_id (or home_club_id, whichever isn't 134) off that row → that's the opposition's siteId.
  3. Optionally read away_team_id (or home_team_id) → pass as teamId to scope to a specific XI (1st, 2nd, etc.).
  4. pc_site_matches(siteId, season, teamId?) → their full fixture list.
  5. pc_match_detail(matchId) on the played ones for scorecards (or pc_site_results for cheaper aggregates).`,
      inputSchema: z.object({
        siteId: z
          .string()
          .describe(
            "Play Cricket site_id of the club. Identical to home_club_id / away_club_id from match summary rows. Percy Main's is 134.",
          ),
        season: z.number().int(),
        teamId: z
          .string()
          .optional()
          .describe(
            "Optional. Pass home_team_id/away_team_id to scope to a single XI. Useful for clubs whose 1st and 2nd XI play in different divisions.",
          ),
      }),
      execute: async ({ siteId, season, teamId }) =>
        cache.getOrSet(
          "pc_site_matches",
          { siteId, season, teamId },
          6 * HOUR,
          () => playCricket.getMatchesForSite(siteId, season, teamId),
        ),
    }),

    pc_site_results: tool({
      description: `Fetch played matches only for a club, with innings totals and league bonus points (batting/bowling/penalty). Much cheaper than fetching N pc_match_detail calls when you just want results, run rates, and form. Like pc_site_matches, accepts ANY club's site_id.`,
      inputSchema: z.object({
        siteId: z.string(),
        season: z.number().int(),
      }),
      execute: async ({ siteId, season }) =>
        cache.getOrSet("pc_site_results", { siteId, season }, 6 * HOUR, () =>
          playCricket.getResultSummaryForSite(siteId, season),
        ),
    }),

    pc_find_opposition_matches: tool({
      description: `Find matches the named opposition team has played against Percy Main in a given season — filters Percy Main's match summary by name, then pulls full scorecards. NOTE: this only sees matches involving Percy Main. To scout an opposition's matches against OTHER clubs, use pc_club_matches instead (look up their club_id from any of our matches against them, then fetch their full season).`,
      inputSchema: z.object({
        oppositionName: z
          .string()
          .describe(
            "Opposition club/team name as it appears in Play Cricket (case-insensitive substring match).",
          ),
        season: z.number().int(),
        limit: z
          .number()
          .int()
          .positive()
          .max(20)
          .default(5)
          .describe(
            "Maximum number of matches to fetch full scorecards for. Default 5 keeps payload manageable.",
          ),
      }),
      execute: async ({ oppositionName, season, limit }) =>
        cache.getOrSet(
          "pc_find_opposition_matches",
          { oppositionName, season, limit },
          6 * HOUR,
          async () => {
            const summary = (await playCricket.getMatchesSummary(season)) as {
              matches?: Array<Record<string, unknown>>;
            };
            const matches = Array.isArray(summary.matches)
              ? summary.matches
              : [];
            const needle = oppositionName.toLowerCase();

            const candidates = matches.filter((m) => {
              const home = pickString(m.home_club_name, m.home_team_name);
              const away = pickString(m.away_club_name, m.away_team_name);
              return (
                home.toLowerCase().includes(needle) ||
                away.toLowerCase().includes(needle)
              );
            });

            const slice = candidates.slice(0, limit);
            const details = await Promise.all(
              slice.map(async (m) => {
                const matchId = pickString(m.id, m.match_id);
                if (!matchId) return null;
                try {
                  return await playCricket.getMatchDetail(matchId);
                } catch (err) {
                  return {
                    matchId,
                    error: err instanceof Error ? err.message : String(err),
                  };
                }
              }),
            );

            return {
              oppositionName,
              season,
              matchedCount: candidates.length,
              fetchedCount: details.filter(Boolean).length,
              matches: details.filter(Boolean),
            };
          },
        ),
    }),
  };
}

export type PlayCricketTools = ReturnType<typeof createPlayCricketTools>;

// First string-or-coercible-to-string in `vals`, else "". Avoids
// `String(unknown)` returning `[object Object]` for unexpected shapes.
function pickString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "bigint") return String(v);
  }
  return "";
}
