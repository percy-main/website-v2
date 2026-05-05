import type { DB } from "@percy-main/db";
import {
  scoutReportContentSchema,
  type ScoutReportContent,
} from "@percy-main/shared";
import { generateText, stepCountIs } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../../config.ts";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { resolveModel } from "../provider.ts";
import { GROUNDING_RULES, IMPORTANT_CONTEXT } from "../system-prompt.ts";
import { createAskDbTool } from "../tools/ask-db.ts";
import { createScoutCache } from "../tools/cache.ts";
import { createFactTools } from "../tools/facts.ts";
import { createPlayCricketTools } from "../tools/play-cricket.ts";
import { createWeatherTools } from "../tools/weather.ts";

export interface ResearchScoutReportParams {
  matchId: string;
  ourTeam: string;
  opposition: string;
  homeAway: "home" | "away";
  matchDate: string;
  competition?: string;
  intent?: string;
}

export interface ResearchScoutReportDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  voyage?: VoyageClient;
  userId: string;
  logger?: FastifyBaseLogger;
}

const RESEARCHER_PROMPT = `You are the RESEARCHER sub-agent inside Scout — a cricket-analysis system for Percy Main CC, a Saturday-league side in the Northumberland and Tyneside Cricket League (NTCL).

You are NOT a chat agent. You do not talk to a user. Your sole job is to compile a single JSON object — the section content for one scouting report — and stop. The orchestrating layer feeds you a match (id, ourTeam, opposition, date, optional competition + intent) and you return the JSON. There is no follow-up turn.

Output contract — read carefully:
- Your final assistant message MUST be a single JSON object matching the schema below.
- No prose before, no prose after. No markdown fences. Just the object.
- All section text fields support inline markdown bold (**word**) and italic (_word_); headings, lists, links, and code do NOT render.
- "Up The Main" is appended by the renderer — do NOT include it in the conclusion.

Schema (TypeScript shape):

{
  intro: string,                         // 1–2 paragraphs naming the match, format, opposition, why it matters
  weather?: {                            // optional — omit if match is >7 days out (forecast unreliable)
    summary: string,                     // plain-English forecast (temp, wind, rain probability, conditions)
    retrievedAt: string,                 // timestamp from your weather_get call, e.g. "2026-05-04 09:23 BST"
    source?: string                      // e.g. "Open-Meteo"
  },
  ourPlayers?: Player[],                 // selected XI/squad with stats — max 15
  ourPlayersCharts?: Chart[],            // 0–4 charts for the "Our players" page
  theirPlayers?: Player[],               // opposition key players — max 15
  theirPlayersCharts?: Chart[],          // 0–4 charts for the "Their players" page
  tossDecision: string,                  // 1–3 sentences on bat/bowl + why
  overallStrategy: string,               // 1–3 sentences on the headline plan
  keyMatchups: string,                   // bowler-vs-batter, batter-vs-bowler plans (own page)
  tactics: string,                       // detailed batting/bowling order, fielding, phase plans (own page)
  conclusion: string,                    // short close — do NOT include "Up The Main"
  references: { label: string, url: string }[]   // every URL fetched while compiling — REQUIRED
}

Player = { name: string, role?: string, notes?: string, stats?: { label: string, value: string }[] (max 8) }
Chart  = { caption: string, spec: <Chart.js v4 config> }   // see chart_render's tool description for the spec shape

Workflow — drive in this order:
1. Selection / our players: ask_db for the selected XI for this match with their season averages, recent scores, headline aggregates. Pull what ourPlayers needs.
2. Opposition: pc_match_summary on their recent fixtures (use their site_id from pc_find_opposition_matches if you don't have it). pc_player_stats on the names that recur as top-scorers / wicket-takers. pc_match_detail only when you need a specific scorecard line. Fold into theirPlayers.
3. Weather: weather_get against the ground lat/lng from a pc_match_summary row for this fixture. Skip only if matchDate is >7 days from today.
4. Facts: fact_retrieve for opposition / venue / scheduling facts. Use them in narrative. URLs of fact sources go in references.
5. Synthesise: tossDecision, overallStrategy, keyMatchups, tactics, conclusion. Do NOT repeat tossDecision content inside tactics.
6. Emit the JSON. Stop.

${GROUNDING_RULES}

Sample / confidence: prioritise the current calendar year. If samples are thin, say so plainly in the relevant section and soften claims accordingly. HIGH = 8+ relevant innings/spells, MEDIUM = 4–7, LOW = 1–3, NONE = no scorecard data. Don't bury an answer under caveats — state the limit once and be useful.

Tactical translations (only what the data licenses):
- Frequent bowled/LBW → make them play straight, attack the stumps, keep it full enough to hit.
- Frequent caught → catching pressure, force riskier scoring shots (don't invent where catches went).
- Frequent stumpings → use slower bowling if available (don't claim they charge every ball).
- Frequent run-outs → pressure the singles, keep the ring sharp.
- Low strike rate → build dots, let pressure work.
- Concentrated team runs → protect against the main threats, attack the rest.
Don't overstate from thin samples.

Charts: include 0–4 in ourPlayersCharts and 0–4 in theirPlayersCharts ONLY where a chart genuinely beats prose (recent form, distribution, head-to-head). The spec is a Chart.js v4 config wrapped in { caption, spec }; specs must have data.datasets[].data, no JS callbacks, ≤1000 total points across all datasets.

Citations: do NOT use cite_fact / cite_match / cite_player_stats — they emit chat-side UI chips that don't apply here. Put every URL you fetched (scorecards, weather, fact sources, stats pages) in the references array instead.

References array — REQUIRED, never empty if you ran any tool that returned a URL. Include scorecard URLs (https://percymain.play-cricket.com/website/results/<matchId>), player-stats URLs, weather forecast URLs, and any fact source URLs.

${IMPORTANT_CONTEXT}

Final reminder: emit JSON ONLY in the final assistant message. No "Here is the report:". No fences. No epilogue. The orchestrator parses your message as JSON and fails if it's not a single object.
`;

/**
 * Extract a JSON object from a model response. The prompt forbids fences/prose
 * but models occasionally ignore that — strip ```json fences and grab the
 * outermost {...} as a fallback. If neither works, return the original string
 * and let JSON.parse throw.
 */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) return fenced[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return raw.slice(first, last + 1);
  }
  return raw.trim();
}

/**
 * Compile the section content for a scout report. Runs an internal model loop
 * with the same data-gathering tools the main agent has (ask_db, pc_*,
 * weather_get, fact_retrieve), but without a UIMessageStreamWriter — the
 * loop's output never reaches the FE wire. Returns the validated JSON
 * content; the caller composes the full ScoutReportPayload by adding the
 * match identifiers.
 *
 * Retries once on Zod validation failure, feeding the validation error back
 * to the model so it can fix its output. After two failures, throws.
 */
export async function researchScoutReport(
  deps: ResearchScoutReportDeps,
  params: ResearchScoutReportParams,
): Promise<ScoutReportContent> {
  const cache = createScoutCache(deps.db);
  const playCricketTools = createPlayCricketTools({
    playCricket: deps.playCricket,
    cache,
    logger: deps.logger,
  });
  const dbTools = createAskDbTool({
    dbReadonly: deps.dbReadonly,
    provider: deps.config.SCOUT_PROVIDER_DB,
    modelId: deps.config.SCOUT_MODEL_DB,
    maxSteps: deps.config.SCOUT_DB_AGENT_MAX_STEPS,
    logger: deps.logger,
  });
  const weatherTools = createWeatherTools({ cache });

  // Researcher gets fact_retrieve only. fact_record is for a chat / debrief
  // interview where the user is dictating facts; cite_fact emits chat-side
  // citation chips that don't apply in a non-streaming sub-agent. The
  // researcher's URLs go in the JSON references array instead.
  let factRetrieveTool = {} as Record<string, unknown>;
  if (deps.voyage) {
    // createFactTools wants a UIMessageStreamWriter (used by cite_fact). Pass
    // a no-op writer; we never expose cite_fact to the researcher so the
    // method is never invoked.
    const noopWriter = {
      write: () => {},
      merge: () => {},
      onError: undefined,
    } as never;
    const allFactTools = createFactTools({
      db: deps.db,
      voyage: deps.voyage,
      userId: deps.userId,
      threadId: undefined,
      writer: noopWriter,
      logger: deps.logger,
    });
    factRetrieveTool = { fact_retrieve: allFactTools.fact_retrieve };
  }

  const tools = {
    ...playCricketTools,
    ...dbTools,
    ...weatherTools,
    ...factRetrieveTool,
  };

  const resolved = resolveModel(
    deps.config.SCOUT_PROVIDER_CHAT,
    deps.config.SCOUT_MODEL_CHAT,
  );

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const todayDisplay = today.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const matchPromptBlock = `MATCH SCOPE — research only this match:
- matchId: ${params.matchId}
- ourTeam: ${params.ourTeam}
- opposition: ${params.opposition}
- homeAway: ${params.homeAway}
- matchDate: ${params.matchDate}
- competition: ${params.competition ?? "(not specified)"}
- intent: ${params.intent ?? "(general scout)"}

Today is ${todayDisplay} (${todayIso}). Treat the match window relative to today when picking the weather forecast horizon.`;

  const runOnce = async (extra: string): Promise<string> => {
    const result = await generateText({
      model: resolved.model,
      system: RESEARCHER_PROMPT,
      prompt: matchPromptBlock + (extra ? `\n\n${extra}` : ""),
      tools,
      stopWhen: stepCountIs(deps.config.SCOUT_RESEARCHER_MAX_STEPS),
    });
    return result.text;
  };

  const firstAttempt = await runOnce("");
  const firstParsed = scoutReportContentSchema.safeParse(
    JSON.parse(extractJson(firstAttempt)),
  );
  if (firstParsed.success) {
    deps.logger?.info(
      { matchId: params.matchId, attempt: 1 },
      "scout_researcher_ok",
    );
    return firstParsed.data;
  }

  deps.logger?.warn(
    { matchId: params.matchId, error: firstParsed.error.message },
    "scout_researcher_validation_failed_retrying",
  );

  const retryAttempt = await runOnce(
    `Your previous output failed schema validation. Errors:\n${firstParsed.error.message}\n\nReturn corrected JSON ONLY — no prose, no fences.`,
  );
  // Throw on second-pass failure — the tool execute will catch and flip the
  // data-report card to status: failed, surfacing a parse error to the FE.
  return scoutReportContentSchema.parse(JSON.parse(extractJson(retryAttempt)));
}
