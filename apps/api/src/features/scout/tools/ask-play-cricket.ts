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
 * chat.
 *
 * Output shape: { answer: string }. The sub-agent runs whatever pc_* calls
 * it needs internally, then SYNTHESISES the gathered data into the exact
 * answer the caller asked for. Earlier shape returned every raw pc_* tool
 * result in `calls[]`; that dumped 50+ fixture rows into the main agent
 * even when the question was "find one specific match". Synthesis-only
 * makes the sub-agent commit to its answer instead of pushing the
 * filtering work upstream.
 */

export interface AskPlayCricketToolDeps {
  playCricket: PlayCricketApiClient;
  db: Kysely<DB>;
  provider: ScoutProvider;
  modelId: string;
  maxSteps: number;
  logger?: FastifyBaseLogger;
}

export function createAskPlayCricketTool(deps: AskPlayCricketToolDeps) {
  const { model } = resolveModel(deps.provider, deps.modelId);

  return {
    ask_play_cricket: tool({
      description: `Answer a question from the Play Cricket public API. Pass a natural-language question; a Play Cricket specialist sub-agent runs the API calls and returns a single \`answer\` string with the synthesised data the caller asked for.

Use this when the answer needs Play Cricket data NOT in our local DB mirror — typically:
  - Opposition's matches against OTHER clubs (their full season, not just vs us).
  - League tables for divisions Percy Main isn't in.
  - Live or very-recent fixtures before the local mirror has synced.
  - Player rosters / play_cricket_ids for opposition clubs.

Examples (each ONE call to ask_play_cricket, not many):
  - "Find Newcastle CC's last 5 league results in 2025."
  - "Get scorecards for these three matches: 7262903, 7262908, 7262912 — every batter's name, runs, balls, how out, and player_id."
  - "Who's on Backworth CC's roster — names and play_cricket_ids."

ASK SPECIFICALLY for what you need — the sub-agent only returns what the question explicitly asks for. "Find the fixture between us and Morpeth on 9 May" gets ONE row back; "list all our 1st XI fixtures this season" gets the full list. Don't expect raw API dumps — if you need a specific projection (every batter's name, runs, how_out), name those fields in the question.

BATCH related questions into one call where it makes sense — "scorecards for these three matches" works, asking three times wastes the sub-agent's setup cost.

DEFAULT TO ask_db FIRST. The local DB mirrors Play Cricket data for matches Percy Main has played in. Only call ask_play_cricket when ask_db cannot answer — i.e. you need data that doesn't involve a Percy Main fixture, or ask_db's summary said the data isn't there yet.

The sub-agent has no chat context — be specific (club name, season, team/XI, format). The \`answer\` it returns IS the data — IDs, dates, names, numbers, in compact structured form. matchIds and playerIds you'll pass to cite_match / cite_player_stats are inside the answer.`,
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

        const system = `You are a Play Cricket API fetcher for Percy Main CSC's Scout system. You call the pc_* tools to gather data, then SYNTHESISE it into the exact answer the caller asked for. The caller does NOT see your raw tool outputs — only your final reply. Your final reply IS the answer.

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

1. **ALWAYS include identifying IDs in your projections.** matches[].id / match_details[].id / players[].player_id (and home_club_id / away_club_id when relevant). The caller needs these to cite sources downstream — your synthesised answer MUST carry the IDs through.

2. **status is unreliable for played-vs-not-played.** Many played matches retain status "New" indefinitely. To decide whether a match was played, use match_date vs today (${ddmmyyyy}). To confirm a result actually exists, prefer pc_site_results or check that innings are populated in pc_match_detail.

3. **site_id == club_id.** To scout opposition X: find a Percy Main vs X match via pc_match_summary, read X's club_id off the row (home_club_id or away_club_id, whichever isn't 134), pass it as siteId to pc_site_matches / pc_site_results.

4. **Stop when the data is right.** After the final pc_* call has the answer payload, synthesise your reply and STOP — don't keep poking. You have ${deps.maxSteps} steps total.

OUTPUT — your final reply IS the answer the caller will use. Write it as compact structured data:

DO:
  - Return ONLY the rows / fields / values the question asked for. If the question asks for one specific match, return one match — even if pc_match_summary returned 80 fixtures along the way.
  - Include the identifying IDs you projected (match.id, player_id, etc.) — the caller cites against them.
  - Use compact form: bullet list, table, or one-line-per-record. Plain text or markdown. NO JSON dumps, NO API-internal field paths.
  - Short note after the data on filters / lookups / caveats: "Filtered season=2026 game_type=League." or "ground_name empty in API — coords unavailable."

DO NOT:
  - Dump every pc_* tool output verbatim. The caller does not need 80 fixtures when they asked for one.
  - Editorialise or write narrative cricket prose ("a strong opening partnership", etc.) — leave that to the caller.
  - Restate the question or write empty filler ("Here are the results:").

If the question is genuinely unanswerable (no data, malformed input, ambiguous), say so in one sentence — no fabrication.`;

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

        const elapsedMs = Date.now() - startedAt;
        const stepCount = result.steps.length;
        const answer = result.text.trim();

        // Diagnostic only — count which pc_* tools fired so we can spot a
        // sub-agent that's over- or under-fetching. The data itself is not
        // returned; the synthesised `answer` is the only output.
        const pcCallNames: string[] = [];
        for (const step of result.steps) {
          for (const part of step.content) {
            if (part.type === "tool-result") {
              pcCallNames.push(part.toolName);
            }
          }
        }

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
            answerChars: answer.length,
            pcCallNames,
          },
          "scout: ask_play_cricket sub-agent done",
        );

        if (!answer) {
          return {
            error:
              "Play Cricket query helper returned no answer. The question may be ambiguous; try rephrasing.",
          };
        }

        return { answer };
      },
    }),
  };
}
