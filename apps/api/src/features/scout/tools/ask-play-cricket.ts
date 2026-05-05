import type { DB } from "@percy-main/db";
import { generateText, stepCountIs, tool } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import { resolveModel, type ScoutProvider } from "../provider.ts";
import { createScoutCache } from "./cache.ts";
import { createPlayCricketTools } from "./play-cricket.ts";

/**
 * ask_play_cricket — the main agent's only door to the Play Cricket API.
 *
 * Same rationale as ask_db (see tools/ask-db.ts): wrap a multi-step external
 * fetcher in its own short-context sub-agent so failed tool calls, dense
 * field-path projections, and the site_id/club_id chain never reach the main
 * chat. Specifically the things the main agent kept tripping on:
 *
 *   - Projection paths. Each pc_* tool description carries dozens of
 *     dot-notation field paths; over-fetching costs tokens, under-fetching
 *     costs a retry. The sub-agent narrows by trial without polluting chat.
 *   - The status-vs-match_date trap. Played matches stay status="New"
 *     forever; the rule "use match_date vs today" lived in every tool
 *     description and the main agent still got it wrong sometimes.
 *   - The site_id/club_id pivot for opposition scouting (find a Percy Main
 *     vs X match → read X's club_id off it → pass as siteId to
 *     pc_site_matches). Two-call lookup chain that's pure plumbing.
 *
 * Scope vs ask_db: ask_db answers anything our local mirror knows
 * (Percy Main matches past or future, our players, opposition stats in the
 * context of how they've done against us). ask_play_cricket is for
 * everything else — opposition's matches against OTHER clubs, league tables
 * for divisions we're not in, fixtures the local mirror hasn't synced.
 *
 * Output shape: { summary, calls: [{ toolName, output }, ...] }. `calls` is
 * EVERY pc_* data tool result the sub-agent produced, in call order — not
 * just the last one. This matters because PC questions are often plural
 * ("scorecards for these three matches" → three pc_match_detail calls); the
 * earlier "return only the last call" shape ate 2/3 of the answer and made
 * the main agent re-ask question by question. `summary` describes the
 * FETCHING process, not the data — same convention as ask_db.summary. The
 * downstream agent has the cricket context and is responsible for narrative.
 */

interface PcCall {
  toolName: string;
  output: unknown;
}

export interface AskPlayCricketToolDeps {
  playCricket: PlayCricketApiClient;
  db: Kysely<DB>;
  provider: ScoutProvider;
  modelId: string;
  maxSteps: number;
  logger?: FastifyBaseLogger;
}

const PC_DATA_TOOL_NAMES = new Set([
  "pc_list_players",
  "pc_match_summary",
  "pc_match_detail",
  "pc_league_table",
  "pc_site_matches",
  "pc_site_results",
  "pc_find_opposition_matches",
]);

export function createAskPlayCricketTool(deps: AskPlayCricketToolDeps) {
  const { model } = resolveModel(deps.provider, deps.modelId);

  return {
    ask_play_cricket: tool({
      description: `Answer a question from the Play Cricket public API. Pass a natural-language question; a Play Cricket specialist sub-agent runs the API calls and returns a short \`summary\` plus a \`calls\` array containing the projected payload from EVERY pc_* call it made.

Use this when the answer needs Play Cricket data NOT in our local DB mirror — typically:
  - Opposition's matches against OTHER clubs (their full season, not just vs us).
  - League tables for divisions Percy Main isn't in.
  - Live or very-recent fixtures before the local mirror has synced.
  - Player rosters / play_cricket_ids for opposition clubs.

Examples (each ONE call to ask_play_cricket, not many):
  - "Find Newcastle CC's last 5 league results in 2025."
  - "Get scorecards for these three matches: 7262903, 7262908, 7262912 — every batter's name, runs, balls, how out, and player_id." (returns three pc_match_detail entries in \`calls\`)
  - "Who's on Backworth CC's roster — names and play_cricket_ids."

BATCH related questions into one call. The sub-agent will happily make several pc_* calls and return them all in \`calls\` — that's exactly what it's for. Calling ask_play_cricket once per match wastes the sub-agent's batching ability and runs up its setup cost N times.

DEFAULT TO ask_db FIRST. The local DB mirrors Play Cricket data for matches Percy Main has played in. Only call ask_play_cricket when ask_db cannot answer — i.e. you need data that doesn't involve a Percy Main fixture, or ask_db's summary said the data isn't there yet.

The sub-agent has no chat context — be specific (club name, season, team/XI, format). \`calls\` is an array of \`{ toolName, output }\` entries, in call order. matchIds and playerIds you'll pass to cite_match / cite_player_stats are in those outputs (sub-agent is required to project them). \`summary\` is metadata about the FETCHING PROCESS (filters applied, the site_id path taken) — read it to verify assumptions and to spot caveats like "player_id only present in roster, not innings.bat[]", but do NOT parrot it back to the user.`,
      inputSchema: z.object({
        question: z
          .string()
          .min(3)
          .describe(
            "Plain-English question. Be specific (club name, season, team/XI, format) — the sub-agent has no chat context.",
          ),
      }),
      execute: async ({ question }) => {
        const cache = createScoutCache(deps.db);
        const tools = createPlayCricketTools({
          playCricket: deps.playCricket,
          cache,
          logger: deps.logger,
        });

        const today = new Date();
        const iso = today.toISOString().slice(0, 10);
        const ddmmyyyy = today.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

        const system = `You are a Play Cricket API fetcher for Percy Main CSC's Scout system. You call the pc_* tools and return raw projected data. A separate downstream agent reads your data and writes the prose reply with cricket context — you do NOT write that prose yourself. Your final reply text is consumed as a short metadata note about the FETCHING PROCESS, not as a narrative of the data.

The downstream agent receives EVERY pc_* call you make, in order — not just the last one. So if a question asks for N matches' scorecards, call pc_match_detail N times and the downstream agent gets all N. Don't try to compress multiple matches into one call.

Today is ${iso} (${ddmmyyyy} dd/mm/yyyy). Current season is ${today.getFullYear()}. The Play Cricket API emits match_date in dd/mm/yyyy — pass values through unchanged.

Tools available:
  - pc_list_players                                      — Percy Main's player roster.
  - pc_match_summary(season, fields)                     — Percy Main's matches in a season.
  - pc_match_detail(matchId, fields)                     — full scorecard for one match.
  - pc_league_table(divisionId)                          — current standings.
  - pc_site_matches(siteId, season, teamId?, fields)     — ANY club's fixtures. site_id == club_id; Percy Main's is 134.
  - pc_site_results(siteId, season, fields)              — ANY club's PLAYED matches with innings totals (cheaper than N pc_match_detail).
  - pc_find_opposition_matches(oppositionName, season, limit?, fields) — Percy Main fixtures against a named opposition with full scorecards.

Each tool's description carries the available field-path projections — read them. Ask for the narrowest projection that answers the question; the underlying API response is cached, so widening on a second call costs nothing at the API boundary.

CRITICAL rules — apply on every call:

1. **ALWAYS include identifying IDs in the projection.** matches[].id / match_details[].id / players[].player_id (and home_club_id / away_club_id when relevant). The downstream agent uses these IDs to cite sources via cite_match / cite_player_stats — without them no citation can be rendered.

2. **status is unreliable for played-vs-not-played.** Many played matches retain status "New" indefinitely. To decide whether a match was played, use match_date vs today (${ddmmyyyy}). To confirm a result actually exists, prefer pc_site_results or check that innings are populated in pc_match_detail.

3. **site_id == club_id.** To scout opposition X: find a Percy Main vs X match via pc_match_summary, read X's club_id off the row (home_club_id or away_club_id, whichever isn't 134), pass it as siteId to pc_site_matches / pc_site_results.

4. **Stop when the data is right.** After the final pc_* call has the answer payload, write your short metadata reply and STOP — don't keep poking. You have ${deps.maxSteps} steps total.

OUTPUT — what to write as your final reply (one short sentence, sometimes two):

DO write:
  - filters and assumptions: "Filtered to game_type=League and season=2025; took the 5 most-recent fixtures."
  - schema choices: "Used pc_site_results (cheaper than per-match detail) — only innings totals were needed."
  - the lookup path for opposition: "Found Newcastle's club_id=152 from Percy Main's 2nd XI fixture on 14/06/2025; pulled their season fixtures from there."
  - failure path: "No Backworth fixtures returned for 2025; their site_id may have changed." or "API returned an empty matches array."

DO NOT write:
  - the data itself or any narrative of it (the downstream agent formats and editorialises)
  - markdown tables of matches or players
  - restating the question
  - empty filler ("Here are the results.")

If the data IS the entire answer (e.g. one league table), just say what filter/lookup you used.`;

        const startedAt = Date.now();
        let result;
        try {
          result = await generateText({
            model,
            system,
            prompt: question,
            tools,
            stopWhen: stepCountIs(deps.maxSteps),
          });
        } catch (err) {
          deps.logger?.error(
            { err, question, provider: deps.provider, model: deps.modelId },
            "ask_play_cricket: sub-agent generateText failed",
          );
          return {
            error:
              "Play Cricket query helper failed. Try rephrasing the question or ask again in a moment.",
          };
        }

        // Collect EVERY pc_* tool result in call order. Earlier shape
        // returned only the last call, which silently dropped 2/3 of the
        // answer when a question covered multiple matches. Done inline
        // because generateText's `steps` is typed against the specific
        // ToolSet passed in, and a helper would either need to be generic
        // or use an unsafe cast.
        const calls: PcCall[] = [];
        for (const step of result.steps) {
          for (const part of step.content) {
            if (
              part.type === "tool-result" &&
              PC_DATA_TOOL_NAMES.has(part.toolName)
            ) {
              calls.push({ toolName: part.toolName, output: part.output });
            }
          }
        }
        const elapsedMs = Date.now() - startedAt;
        const stepCount = result.steps.length;

        deps.logger?.info(
          {
            event: "scout.ask_play_cricket",
            question,
            provider: deps.provider,
            model: deps.modelId,
            stepCount,
            elapsedMs,
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            callCount: calls.length,
            toolNames: calls.map((c) => c.toolName),
          },
          "scout: ask_play_cricket sub-agent done",
        );

        const summary = result.text.trim();
        if (!summary && calls.length === 0) {
          return {
            error:
              "Play Cricket query helper returned no answer. The question may be ambiguous; try rephrasing.",
          };
        }

        return {
          summary: summary || null,
          calls,
        };
      },
    }),
  };
}
