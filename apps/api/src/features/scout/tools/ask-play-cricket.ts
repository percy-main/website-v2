import type { DB } from "@percy-main/db";
import { generateText, stepCountIs, tool } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import {
  deepseekFastProviderOptions,
  resolveModel,
  type ScoutProvider,
} from "../provider.ts";
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
 * Output shape: { data: unknown, note?: string }. The sub-agent runs
 * whatever pc_* calls it needs internally, then SYNTHESISES the gathered
 * data into a structured JSON object whose shape matches the caller's
 * question (one record / array of rows / nested scorecard / etc.). The
 * tool parses the sub-agent's final reply as JSON and surfaces it as
 * `data`. An optional `note` carries one-line caveats (filters used,
 * fields unavailable, etc.) — never narrative.
 *
 * Earlier shapes:
 *   - calls[] of every raw pc_* tool result — dumped 50+ fixture rows
 *     when the question was "find one match".
 *   - { answer: string } — forced complex tabular questions through prose,
 *     which the caller then re-parsed.
 *
 * Structured JSON gives the sub-agent freedom to pick the shape (rows,
 * single record, nested) while keeping the output a few hundred tokens
 * instead of tens of thousands.
 */

/**
 * Pull a JSON blob out of the sub-agent's final reply, regardless of how
 * chatty / fenced / sloppy it is. The sub-agent's prompt asks for naked
 * JSON, but Sonnet/Haiku frequently wrap the object in conversational
 * prose anyway ("Perfect! Here's the fixture: ```json {...} ``` The
 * match is on..."). This function tolerates that without blowing up.
 *
 * Strategy:
 *   1. Reply is a clean JSON object → use as-is. (extraction=naked)
 *   2. Reply contains one or more ```json fenced blocks → use the LAST.
 *      (extraction=fenced) The "last" rule mirrors how the model usually
 *      iterates: earlier fences are scratch work, the final answer is
 *      the last one before any closing prose.
 *   3. Reply has matching '{' / '}' somewhere → take the substring
 *      between them. (extraction=braces) Works for inlined JSON without
 *      fences.
 *   4. Otherwise → return the trimmed reply, let the caller's JSON.parse
 *      throw and surface the parseFailed path.
 *
 * Exported for unit testing — keep it pure (no logger / no side effects).
 */
export function extractJsonCandidate(raw: string): {
  candidate: string;
  extraction: "naked" | "fenced" | "braces";
} {
  const fencedRe = /```(?:json)?\s*([\s\S]+?)\s*```/gi;
  const fenceMatches = Array.from(raw.matchAll(fencedRe));
  const trimmed = raw.trim();
  if (
    trimmed.startsWith("{") &&
    trimmed.endsWith("}") &&
    fenceMatches.length === 0
  ) {
    return { candidate: trimmed, extraction: "naked" };
  }
  if (fenceMatches.length > 0) {
    return {
      candidate: fenceMatches[fenceMatches.length - 1][1].trim(),
      extraction: "fenced",
    };
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return { candidate: raw.slice(first, last + 1), extraction: "braces" };
  }
  return { candidate: trimmed, extraction: "naked" };
}

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
      description: `Answer a question from the Play Cricket public API. Pass a natural-language question; a specialist sub-agent runs the API calls and returns a structured JSON object: \`{ data, note? }\`. \`data\` is the synthesised answer in whatever JSON shape best fits the question (single record, array of rows, nested scorecard); \`note\` is an optional one-line caveat.

Use this when the answer needs Play Cricket data NOT in our local DB mirror — typically:
  - Opposition's matches against OTHER clubs (their full season, not just vs us).
  - League tables for divisions Percy Main isn't in.
  - Live or very-recent fixtures before the local mirror has synced.
  - Player rosters / play_cricket_ids for opposition clubs.

Examples (each ONE call to ask_play_cricket, not many):
  - "Find Newcastle CC's last 5 league results in 2025."
    → data is an array of 5 result rows.
  - "Get scorecards for matches 7262903, 7262908, 7262912 — batters' name/runs/balls/how_out and bowlers' overs/wickets/runs."
    → data is an array of 3 match objects, each with batting and bowling arrays.
  - "Find Percy Main's fixture vs Morpeth on 9 May 2026 — match_id, teams, competition, home/away."
    → data is one fixture object.
  - "Who's on Backworth CC's roster — names and play_cricket_ids."
    → data is an array of player objects.

ASK SPECIFICALLY for the fields you need — the sub-agent shapes \`data\` to match. Naming fields in the question ("name, runs, balls, how_out") drives the projection used; vague questions get vague shapes.

BATCH related questions into one call where it makes sense — "scorecards for these three matches" works, asking three times wastes the sub-agent's setup cost.

DEFAULT TO ask_db FIRST. The local DB mirrors Play Cricket data for matches Percy Main has played in. Only call ask_play_cricket when ask_db cannot answer — i.e. you need data that doesn't involve a Percy Main fixture, or ask_db's summary said the data isn't there yet.

The sub-agent has no chat context — be specific (club name, season, team/XI, format). \`data\` always carries identifying IDs (match.id, player_id, club_id) so you can cite via cite_match / cite_player_stats afterwards.`,
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

        const system = `You are a Play Cricket API fetcher for Percy Main CSC's Scout system. You call the pc_* tools to gather data, then SYNTHESISE it into a structured JSON object that answers the caller's question. The caller does NOT see your raw tool outputs — only the JSON you emit as your final reply.

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

CRITICAL rules:

1. **ALWAYS include identifying IDs in your projections AND in your final JSON.** matches[].id / match_details[].id / players[].player_id (and home_club_id / away_club_id when relevant). The caller needs these to cite via cite_match / cite_player_stats.

2. **status is unreliable for played-vs-not-played.** Many played matches retain status "New" indefinitely. Use match_date vs today (${ddmmyyyy}). To confirm a result, prefer pc_site_results or check that innings are populated in pc_match_detail.

3. **site_id == club_id.** To scout opposition X: find a Percy Main vs X match via pc_match_summary, read X's club_id off the row (home_club_id or away_club_id, whichever isn't 134), pass it as siteId to pc_site_matches / pc_site_results.

4. **Stop when the data is right.** After the final pc_* call has the answer payload, emit JSON and STOP — don't keep poking. You have ${deps.maxSteps} steps total.

OUTPUT FORMAT — your final assistant message is a single JSON object, nothing else:

{
  "data": <the answer, in whatever JSON shape best fits the question>,
  "note": <optional one-line caveat string, omit if none>
}

NO prose before or after, NO markdown fences, NO comments — just the JSON object.

Shape \`data\` to match the question:
  - "Find the fixture vs Morpeth on 9 May" → data is one fixture object: { id, match_date, ourTeam, opposition, competition, homeAway, ground }.
  - "Get scorecards for matches A, B, C" → data is an array of 3 match objects, each with { id, match_date, batting: [...], bowling: [...] }.
  - "List Backworth's 2025 fixtures" → data is an array of fixture rows.
  - "League table for division X" → data is an array of standing rows: { team, P, W, L, Pts }.

DO:
  - Pick concise field names suited to the question (matchId or id, runs, balls, how_out — not the full API field paths).
  - Include ONLY rows the question asked for. If pc_match_summary returned 80 fixtures, filter to the one(s) the caller wanted.
  - Carry IDs through every record. matchId / playerId / clubId are non-negotiable.
  - Use \`note\` for filters/caveats: "Filtered season=2026 game_type=League." / "API ground_name empty — coords unavailable." / "10 of 11 fixtures had populated scorecards; one match TBC."

DO NOT:
  - Wrap data in arbitrary keys like { "results": [...] }. Just put the array directly in \`data\`.
  - Editorialise or write narrative cricket prose — the caller does that.
  - Dump every pc_* tool output verbatim — synthesise.

If the question is genuinely unanswerable (no data found, ambiguous input), emit { "data": null, "note": "<one-sentence reason>" }.`;

        const startedAt = Date.now();
        let result;
        try {
          result = await generateText({
            model,
            system,
            prompt: question,
            tools,
            stopWhen: stepCountIs(deps.maxSteps),
            providerOptions: deepseekFastProviderOptions(deps.provider),
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
        const raw = result.text.trim();

        // Diagnostic only — count which pc_* tools fired so we can spot a
        // sub-agent that's over- or under-fetching. The data itself is not
        // surfaced; the synthesised JSON is the only output.
        const pcCallNames: string[] = [];
        for (const step of result.steps) {
          for (const part of step.content) {
            if (part.type === "tool-result") {
              pcCallNames.push(part.toolName);
            }
          }
        }

        // Extract the JSON object from the sub-agent's reply. Models
        // routinely wrap the object in narrative prose ("Perfect! Here's
        // the fixture: ```json {...} ``` The match is on...") despite
        // the prompt asking for JSON only. Strategy:
        //   1. If there's a ```json (or ```) fenced block anywhere in
        //      the reply, take the LAST such block (the model's final
        //      answer if it iterated).
        //   2. Otherwise, take the largest substring from the first '{'
        //      to the last '}'.
        //   3. JSON.parse and continue.
        const { candidate, extraction } = extractJsonCandidate(raw);

        let data: unknown = null;
        let note: string | undefined;
        let parseFailed = false;
        try {
          const parsed = JSON.parse(candidate) as unknown;
          if (
            parsed != null &&
            typeof parsed === "object" &&
            "data" in parsed
          ) {
            const obj = parsed as { data: unknown; note?: unknown };
            data = obj.data;
            note = typeof obj.note === "string" ? obj.note : undefined;
          } else {
            // Sub-agent emitted naked JSON without the {data, note}
            // envelope. Treat the whole thing as data — cheaper than
            // failing.
            data = parsed;
          }
        } catch {
          parseFailed = true;
          deps.logger?.warn(
            {
              event: "scout.ask_play_cricket.parse_failed",
              question,
              rawSample: raw.slice(0, 200),
            },
            "ask_play_cricket: sub-agent reply was not JSON; surfacing as text",
          );
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
            outputChars: raw.length,
            pcCallNames,
            parseFailed,
            extraction,
          },
          "scout: ask_play_cricket sub-agent done",
        );

        if (parseFailed) {
          return {
            data: null,
            note: `Sub-agent reply was not valid JSON. Raw text: ${raw.slice(0, 500)}`,
          };
        }

        if (!raw) {
          return {
            error:
              "Play Cricket query helper returned no answer. The question may be ambiguous; try rephrasing.",
          };
        }

        return note ? { data, note } : { data };
      },
    }),
  };
}
