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

    pc_club_matches: tool({
      description: `Fetch the full season's fixtures for ANY Play Cricket club, not just Percy Main — both home and away matches against every opponent. This is the right tool for scouting an opposition: it returns matches that opposition has played against everyone (not only against us).

Workflow:
  1. Call pc_match_summary(season) and find a recent match where Percy Main played the opposition.
  2. Read home_club_id / away_club_id off that match — whichever isn't Percy Main is the opposition's club_id.
  3. Call pc_club_matches(clubId, season) to see their full season.
  4. Use pc_match_detail on individual matchIds for scorecards.

Returns the same MatchSummary shape as pc_match_summary.`,
      inputSchema: z.object({
        clubId: z
          .string()
          .describe(
            "Play Cricket club id (NOT site_id, NOT team_id). Find via home_club_id/away_club_id in match summary rows.",
          ),
        season: z.number().int(),
      }),
      execute: async ({ clubId, season }) =>
        cache.getOrSet("pc_club_matches", { clubId, season }, 6 * HOUR, () =>
          playCricket.getMatchesForClub(clubId, season),
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
              const home = String(m.home_club_name ?? m.home_team_name ?? "");
              const away = String(m.away_club_name ?? m.away_team_name ?? "");
              return (
                home.toLowerCase().includes(needle) ||
                away.toLowerCase().includes(needle)
              );
            });

            const slice = candidates.slice(0, limit);
            const details = await Promise.all(
              slice.map(async (m) => {
                const matchId = String(m.id ?? m.match_id ?? "");
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
