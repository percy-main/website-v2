import { tool } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { ScoutCache } from "./cache.ts";
import { approxJsonBytes } from "./payload-size.ts";
import { project } from "./projector.ts";

const HOUR = 60 * 60;

export interface PlayCricketToolDeps {
  playCricket: PlayCricketApiClient;
  cache: ScoutCache;
  logger?: FastifyBaseLogger;
}

// Wraps a tool's execute fn so we record raw vs. projected payload sizes
// per call. Lets us see how much projection is actually shrinking — the
// pair of numbers is the headline cost-reduction signal alongside
// scout.turn cache ratios. Logger is optional so tests don't have to
// wire one up.
function logPayload(
  logger: FastifyBaseLogger | undefined,
  tool: string,
  fields: string[],
  raw: unknown,
  projected: unknown,
): void {
  if (!logger) return;
  const rawBytes = approxJsonBytes(raw);
  const projectedBytes = approxJsonBytes(projected);
  logger.info(
    {
      event: "scout.tool.payload",
      tool,
      fields,
      rawBytes,
      projectedBytes,
      ratio:
        rawBytes > 0 ? Number((projectedBytes / rawBytes).toFixed(3)) : null,
    },
    "scout tool payload projected",
  );
}

// Required on every heavy PC tool so the model is forced to think about
// what bytes it actually needs. We cache the raw API response and project
// here on read — different field selections of the same match share the
// underlying cache row.
const fieldsSchema = z
  .array(z.string().min(1))
  .min(1)
  .describe(
    "Required. Dot-notation paths to keep in the response. Use foo[].bar to project across array elements (e.g. matches[].id). See this tool's description for the available paths.",
  );

export function createPlayCricketTools(deps: PlayCricketToolDeps) {
  const { playCricket, cache, logger } = deps;

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
      description: `Fetch a season's worth of Percy Main CC match summaries. Use this to find matches by opposition or date before drilling into a specific game.

Available field paths (pass any subset via \`fields\`):
  matches[].id                  — Play Cricket match id (use with pc_match_detail)
  matches[].status              — UNRELIABLE for whether the match was played; see note below
  matches[].match_date          — dd/mm/yyyy
  matches[].match_time
  matches[].ground_name
  matches[].competition_name    — league/cup name
  matches[].league_name
  matches[].competition_type
  matches[].game_type           — "T20", "Limited Overs", etc.
  matches[].home_club_name, matches[].home_club_id, matches[].home_team_name, matches[].home_team_id
  matches[].away_club_name, matches[].away_club_id, matches[].away_team_name, matches[].away_team_id

CRITICAL — do NOT use status to decide whether a match was played. Many played matches in Play Cricket retain status "New" indefinitely (clubs often never flip it to "Result"). To determine whether a match was played, use match_date vs today: a date in the past with no cancellation/abandonment marker means it was almost certainly played, regardless of status. To confirm a result actually exists for a match, call pc_match_detail and check whether innings are populated, or use pc_site_results (which only returns played matches).

Tip: when finding the next/last fixture, prefer ["matches[].id", "matches[].match_date", "matches[].home_team_name", "matches[].away_team_name"] and filter by date relative to today.`,
      inputSchema: z.object({
        season: z
          .number()
          .int()
          .describe(
            "Season year, e.g. 2025. Play Cricket seasons are calendar years.",
          ),
        fields: fieldsSchema,
      }),
      execute: async ({ season, fields }) => {
        const raw = await cache.getOrSet(
          "pc_match_summary",
          { season },
          6 * HOUR,
          () => playCricket.getMatchesSummary(season),
        );
        const projected = project(raw, fields);
        logPayload(logger, "pc_match_summary", fields, raw, projected);
        return projected;
      },
    }),

    pc_match_detail: tool({
      description: `Fetch the full scorecard for a single match — both innings, batting & bowling figures, fall of wickets. Use after pc_match_summary to dig into a specific game.

The response is wrapped: { match_details: [<match>] } (always one match per call).

Available field paths under match_details[]:
  match_details[].id, match_details[].match_date, match_details[].season
  match_details[].home_team_name, match_details[].home_team_id, match_details[].home_club_name
  match_details[].away_team_name, match_details[].away_team_id, match_details[].away_club_name
  match_details[].toss             — who won the toss
  match_details[].batted_first     — team that batted first
  match_details[].result, match_details[].result_description
  match_details[].players[].home_team[].player_name, match_details[].players[].away_team[].player_name
  match_details[].innings[].team_batting_name, match_details[].innings[].innings_number
  match_details[].innings[].runs, match_details[].innings[].wickets, match_details[].innings[].overs
  match_details[].innings[].total_extras, match_details[].innings[].declared
  match_details[].innings[].bat[].position, match_details[].innings[].bat[].batsman_name
  match_details[].innings[].bat[].how_out, match_details[].innings[].bat[].fielder_name, match_details[].innings[].bat[].bowler_name
  match_details[].innings[].bat[].runs, match_details[].innings[].bat[].balls, match_details[].innings[].bat[].fours, match_details[].innings[].bat[].sixes
  match_details[].innings[].bowl[].bowler_name
  match_details[].innings[].bowl[].overs, match_details[].innings[].bowl[].maidens
  match_details[].innings[].bowl[].runs, match_details[].innings[].bowl[].wickets
  match_details[].innings[].bowl[].wides, match_details[].innings[].bowl[].no_balls
  match_details[].innings[].fow[].runs, match_details[].innings[].fow[].wickets, match_details[].innings[].fow[].batsman_out_name

Ask for the narrowest set that answers the question — e.g. for innings totals only, ["match_details[].match_date", "match_details[].innings[].team_batting_name", "match_details[].innings[].runs", "match_details[].innings[].wickets"].`,
      inputSchema: z.object({
        matchId: z
          .string()
          .describe("Play Cricket match id from pc_match_summary."),
        fields: fieldsSchema,
      }),
      execute: async ({ matchId, fields }) => {
        const raw = await cache.getOrSet(
          "pc_match_detail",
          { matchId },
          24 * HOUR,
          () => playCricket.getMatchDetail(matchId),
        );
        const projected = project(raw, fields);
        logPayload(logger, "pc_match_detail", fields, raw, projected);
        return projected;
      },
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
  5. pc_match_detail(matchId) on the played ones for scorecards (or pc_site_results for cheaper aggregates).

Same response shape and field paths as pc_match_summary — see that tool's description for the matches[].* paths AND the critical note about matches[].status being unreliable for whether a match was played (use match_date vs today instead).`,
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
        fields: fieldsSchema,
      }),
      execute: async ({ siteId, season, teamId, fields }) => {
        const raw = await cache.getOrSet(
          "pc_site_matches",
          { siteId, season, teamId },
          6 * HOUR,
          () => playCricket.getMatchesForSite(siteId, season, teamId),
        );
        const projected = project(raw, fields);
        logPayload(logger, "pc_site_matches", fields, raw, projected);
        return projected;
      },
    }),

    pc_site_results: tool({
      description: `Fetch played matches only for a club, with innings totals and league bonus points (batting/bowling/penalty). Much cheaper than fetching N pc_match_detail calls when you just want results, run rates, and form. Like pc_site_matches, accepts ANY club's site_id.

Response shape: { result_summary: [<row>...] }. Each row contains the same identifying fields as a match summary row plus innings totals and bonus points. Common useful paths:
  result_summary[].id
  result_summary[].match_date
  result_summary[].home_club_name, result_summary[].home_team_name, result_summary[].home_club_id, result_summary[].home_team_id
  result_summary[].away_club_name, result_summary[].away_team_name, result_summary[].away_club_id, result_summary[].away_team_id
  result_summary[].result, result_summary[].result_applied_to, result_summary[].batted_first, result_summary[].toss
  result_summary[].innings[]                    — innings totals (use [] alone to keep all fields per innings)
  result_summary[].innings[].team_batting_name, result_summary[].innings[].team_batting_id
  result_summary[].innings[].runs, result_summary[].innings[].wickets, result_summary[].innings[].overs
  result_summary[].innings[].declared
  result_summary[].batting_points, result_summary[].bowling_points, result_summary[].penalty_runs

Field names for bonus points may vary by competition; if a path looks empty, ask for result_summary[] (the whole row) on a single example match to inspect what's actually returned.`,
      inputSchema: z.object({
        siteId: z.string(),
        season: z.number().int(),
        fields: fieldsSchema,
      }),
      execute: async ({ siteId, season, fields }) => {
        const raw = await cache.getOrSet(
          "pc_site_results",
          { siteId, season },
          6 * HOUR,
          () => playCricket.getResultSummaryForSite(siteId, season),
        );
        const projected = project(raw, fields);
        logPayload(logger, "pc_site_results", fields, raw, projected);
        return projected;
      },
    }),

    pc_find_opposition_matches: tool({
      description: `Find matches the named opposition team has played against Percy Main in a given season — filters Percy Main's match summary by name, then pulls full scorecards. NOTE: this only sees matches involving Percy Main. To scout an opposition's matches against OTHER clubs, use pc_site_matches instead (look up their site_id via home_club_id/away_club_id from any of our matches against them, then fetch their full season).

Response shape: { oppositionName, season, matchedCount, fetchedCount, matches: [<full match-detail response>] }. Each entry in matches[] is a full match-detail response, so its inner shape is matches[].match_details[].* — use the same paths documented on pc_match_detail, just prefixed with matches[].

Examples:
  ["matchedCount", "fetchedCount"]   — just the counts
  ["matches[].match_details[].match_date", "matches[].match_details[].innings[].team_batting_name", "matches[].match_details[].innings[].runs", "matches[].match_details[].innings[].wickets"]   — innings totals across all matched games`,
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
        fields: fieldsSchema,
      }),
      execute: async ({ oppositionName, season, limit, fields }) => {
        const raw = await cache.getOrSet(
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
        );
        const projected = project(raw, fields);
        logPayload(
          logger,
          "pc_find_opposition_matches",
          fields,
          raw,
          projected,
        );
        return projected;
      },
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
