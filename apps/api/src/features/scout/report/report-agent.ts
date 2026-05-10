import type { DB } from "@percy-main/db";
import type { ScoutReportContent } from "@percy-main/shared";
import { generateText, stepCountIs } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../../config.ts";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { deepseekFastProviderOptions, resolveModel } from "../provider.ts";
import { GROUNDING_RULES, IMPORTANT_CONTEXT } from "../system-prompt.ts";
import { createAskDbTool } from "../tools/ask-db.ts";
import { createScoutCache } from "../tools/cache.ts";
import { createFactTools } from "../tools/facts.ts";
import { createPlayCricketCitationTools } from "../tools/play-cricket-citations.ts";
import { createPlayCricketTools } from "../tools/play-cricket.ts";
import { createWeatherTools } from "../tools/weather.ts";
import { CitationAccumulator } from "./citation-accumulator.ts";
import {
  createSectionTools,
  ReportContentAccumulator,
} from "./section-tools.ts";

export interface ReportAgentParams {
  matchId: string;
  ourTeam: string;
  opposition: string;
  homeAway: "home" | "away";
  matchDate: string;
  competition?: string;
  intent?: string;
}

export interface ReportAgentDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  voyage?: VoyageClient;
  userId: string;
  logger: FastifyBaseLogger;
  /** Optional external cancellation signal — combined with the internal
   *  timeout so a worker-level cancel (user clicked Stop on an in-flight
   *  report) aborts the AI SDK loop. */
  cancelSignal?: AbortSignal;
}

export interface ReportAgentOutput {
  content: ScoutReportContent;
  chartSpecs: Record<string, import("@percy-main/shared").ChartSpec>;
}

// Hard sanity backstop for the AI SDK loop. Real budget is the wall-clock
// timeout (SCOUT_REPORT_TIMEOUT_MS); this just prevents an infinite loop if
// the model gets stuck never emitting a final response. Set high enough
// that no real report ever hits it.
const SAFETY_STEP_CAP = 500;

const REPORT_AGENT_PROMPT = `You are Scout's report builder — a cricket analyst writing one PDF scouting report for Percy Main CC, a Saturday-league side in the Northumberland and Tyneside Cricket League (NTCL).

You receive ONE match's scope (matchId, our team, opposition, date, competition) and have a tool surface to gather data and emit the report. There is no separate research phase — gather, analyse, write, refine, all interleaved as you see fit.

OUTPUT MODEL — the most important thing on this page:

You do NOT emit the report as a JSON object at the end. You build it incrementally by calling structured-output tools as you work. The user only sees the assembled report when you stop calling tools and the loop ends — your prose between tool calls is internal scratch space, never shown.

Required-section tools (you MUST call each at least once before you stop):
  - set_intro(text)            — 1–2 paragraph overview
  - set_toss_decision(text)    — 1–3 sentences
  - set_overall_strategy(text) — 1–3 sentences
  - set_key_matchups(text)     — match-up plans, paragraphs
  - set_tactics(text)          — detailed phase / order / fielding
  - set_conclusion(text)       — short close ("Up The Main" appended automatically)

Last call wins. If you write set_intro early then learn something material, just call set_intro again — the earlier write is overwritten.

Optional-section tools:
  - set_weather({ summary, retrievedAt, source? })           — call after weather_get if matchDate ≤ 7 days out
  - set_league_table({ name?, columns, rows })               — call after pc_league_table for league fixtures
  - add_our_player({ name, role?, notes?, stats? })          — call once per player; order = call order; max 15
  - add_their_player({ name, role?, notes?, stats? })        — same; max 15
  - chart_render({ chart, section, caption })                — Chart.js v4 spec; goes under that section's players

Data-gathering tools (call as needed; interleave with output tools):
  - ask_db                     — local DB (past Percy Main matches, our internal scheduling, our players' stats). NOT for league standings or future opposition fixtures.
  - pc_match_summary, pc_match_detail, pc_league_table, pc_site_matches, pc_site_results, pc_find_opposition_matches, pc_list_players — Play Cricket API. ALWAYS pass narrow \`fields\` projections. ALWAYS pair every \`*_id\` projection with the matching \`*_name\` field on the SAME call — never infer names from numeric ids.
  - weather_get / weather_geocode  — open-meteo forecast for ground lat/lng.
  - fact_retrieve                  — recorded captain/club facts.
  - cite_match(matchId, claim, ...)         — cite a single specific match; URL goes on the references page
  - cite_player_stats(playerId, statType, claim, ...) — cite aggregate stats; URL goes on references page
  - cite_fact(factId, claim)                — cite a recorded fact; no URL but call for grounding discipline

Recommended workflow (interleave freely):

1. Match scope sanity — pc_match_detail with the names + ground projection. Pick up the opposition's club_id while you're there.

2. Selection / our players. ask_db for the selected XI plus their season batting / bowling figures and last-6-innings scores. add_our_player for each. cite_player_stats for any aggregate you quote.

3. Opposition recent form. pc_site_results(siteId=<their clubId>, season) for their last played matches with innings totals. pc_match_detail on the games where you want full batter/bowler lines. Add the threats via add_their_player. cite_match / cite_player_stats as you go.

4. League table. For league fixtures, divisionId for pc_league_table === competition_id on any league match-summary row. set_league_table with the result. Mark our row highlight:"us", opposition's highlight:"opposition". Skip for cup / friendly. The league table is the SOURCE OF TRUTH for any team's W/L record — never derive W/L from scorecards.

5. Weather. ground lat/lng comes off pc_match_summary or pc_match_detail. weather_get with that → set_weather. Skip if matchDate > 7 days out.

6. Facts. fact_retrieve for venue / scheduling / mechanics facts. Weave any relevant ones into player notes / tactics. cite_fact on the supporting claims.

7. Charts. Optional. Call chart_render with section + caption when a trend or distribution adds genuine value.

8. Synthesis. set_intro / set_toss_decision / set_overall_strategy / set_key_matchups / set_tactics / set_conclusion as the picture comes together. You can write a section, then go fetch one more thing, then refine that section — call set_X again.

When you've called every required-section tool and you're done, just stop calling tools and emit a final short text. The loop ends and the pipeline assembles the report from your tool calls.

There is no retry — if you finish without calling all of set_intro / set_toss_decision / set_overall_strategy / set_key_matchups / set_tactics / set_conclusion, the report fails. Likewise the assembled content must satisfy the shared schema (max 15 add_our_player / add_their_player calls each, max 4 chart_render calls per section, intro >= 20 chars, etc.); exceeding those caps fails the report. Stay within the limits.

Hard rules:

- NEVER infer or invent NAMES from numeric ids. team_ids, club_ids, player_ids, competition_ids are NUMBERS. When you project an *_id field, pair it with the matching *_name on the SAME pc_* call.

- ALWAYS pass narrow \`fields\` projections to pc_* tools. The underlying API response is cached, so widening on a second call costs nothing at the API.

- ask_db is a black box. NEVER name tables, columns, or DB structure in your questions. Cricket terms only.

- Cite generously but only when grounded. The references page falls out of cite_match / cite_player_stats calls — claims you don't cite get no URL on it.

- Do NOT try to emit the report as JSON in your final message. The output channel is the set_* / add_* / chart_render tools.

${GROUNDING_RULES}

${IMPORTANT_CONTEXT}
`;

/**
 * Run the unified report agent. The model's final assistant message is
 * discarded — output flows entirely through the section-tools accumulator.
 *
 * On missing required sections the function feeds a one-shot retry asking
 * the model to call the missing tools and emit a confirming final text.
 * Hard-fails after the second attempt.
 *
 * Returns the assembled content + the chart-spec map (so the caller can
 * resolve charts at render time). Citation URLs are captured into the
 * supplied CitationAccumulator during the run; the caller reads its
 * .snapshot() to populate payload.references.
 */
export async function runReportAgent(
  deps: ReportAgentDeps,
  params: ReportAgentParams,
  citations: CitationAccumulator,
): Promise<ReportAgentOutput> {
  const cache = createScoutCache(deps.db);
  const accumulator = new ReportContentAccumulator();

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
  const sectionTools = createSectionTools({ accumulator });
  // Citation tools: writer omitted (no FE stream during reports), accumulator
  // captures URLs for the references page.
  const citationTools = createPlayCricketCitationTools({
    accumulator: citations,
  });

  // fact_retrieve / cite_fact need a writer to satisfy the FactToolDeps
  // shape. We pass a noop writer — cite_fact's stream-emit becomes a no-op,
  // fact_retrieve doesn't touch the writer at all.
  let factTools = {} as Record<string, unknown>;
  if (deps.voyage) {
    const noop = (): void => undefined;
    const noopWriter = {
      write: noop,
      merge: noop,
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
    factTools = {
      fact_retrieve: allFactTools.fact_retrieve,
      cite_fact: allFactTools.cite_fact,
    };
  }

  const tools = {
    ...playCricketTools,
    ...dbTools,
    ...weatherTools,
    ...sectionTools,
    ...citationTools,
    ...factTools,
  };

  const resolved = resolveModel(
    deps.config.SCOUT_PROVIDER_REPORT,
    deps.config.SCOUT_MODEL_REPORT,
  );

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const todayDisplay = today.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const scopeBlock = `MATCH SCOPE — write the report for THIS match:
- matchId: ${params.matchId}
- ourTeam: ${params.ourTeam}
- opposition: ${params.opposition}
- homeAway: ${params.homeAway}
- matchDate: ${params.matchDate}
- competition: ${params.competition ?? "(not specified)"}
- intent: ${params.intent ?? "(general scout — gather a balanced packet)"}

Today is ${todayDisplay} (${todayIso}). Use this for relative-date filters and the weather-horizon decision.

Build the report now via the tool surface above. Stop calling tools when you've covered every required section.`;

  const runOnce = async (extra: string, attempt: number): Promise<void> => {
    const stepStart = Date.now();
    deps.logger.info(
      {
        matchId: params.matchId,
        attempt,
        timeoutMs: deps.config.SCOUT_REPORT_TIMEOUT_MS,
      },
      "scout_report_agent_started",
    );

    let stepIndex = 0;
    try {
      await generateText({
        model: resolved.model,
        system: REPORT_AGENT_PROMPT,
        prompt: `${scopeBlock}${extra ? `\n\n${extra}` : ""}`,
        tools,
        // Wall-clock is the real budget; this is just a runaway-loop backstop.
        stopWhen: stepCountIs(SAFETY_STEP_CAP),
        providerOptions: deepseekFastProviderOptions(resolved.provider),
        abortSignal: deps.cancelSignal
          ? AbortSignal.any([
              deps.cancelSignal,
              AbortSignal.timeout(deps.config.SCOUT_REPORT_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(deps.config.SCOUT_REPORT_TIMEOUT_MS),
        onStepFinish: ({ toolCalls, finishReason }) => {
          stepIndex += 1;
          deps.logger.info(
            {
              matchId: params.matchId,
              attempt,
              step: stepIndex,
              toolCalls: toolCalls.map((c) => c.toolName),
              finishReason,
              elapsedMs: Date.now() - stepStart,
            },
            "scout_report_agent_step",
          );
        },
      });
      deps.logger.info(
        {
          matchId: params.matchId,
          attempt,
          steps: stepIndex,
          ms: Date.now() - stepStart,
        },
        "scout_report_agent_step_done",
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      // User-initiated Stop sets `cancelSignal.aborted` from the outer
      // poller. AbortError lands in here too — treat both as cancellation
      // and log at INFO so ops doesn't see a phantom error every time the
      // captain hits Stop during a retry.
      const isCancelled = deps.cancelSignal?.aborted ?? false;
      const logFields = {
        matchId: params.matchId,
        attempt,
        err,
        isTimeout,
        isCancelled,
        stepsCompleted: stepIndex,
        elapsedMs: Date.now() - stepStart,
      };
      if (isCancelled) {
        deps.logger.info(logFields, "scout_report_agent_step_cancelled");
      } else {
        deps.logger.error(logFields, "scout_report_agent_step_failed");
      }
      if (isTimeout) {
        throw new Error(
          `Report agent timed out after ${deps.config.SCOUT_REPORT_TIMEOUT_MS}ms on attempt ${attempt} (${stepIndex} steps).`,
          { cause: err },
        );
      }
      throw err;
    }
  };

  const startedAt = Date.now();
  await runOnce("", 1);
  const assembled = accumulator.toContent();

  if (!assembled.ok) {
    // No retry path. A 30-min loop that didn't call set_intro doesn't get
    // saved by a re-prompt without context — and passing the prior call's
    // messages forward makes the prompt + tool-result context expensive
    // for a long-tail recovery. Hard-fail loud; runReport persists the
    // message to scout_report.error_message so the captain sees it.
    if (assembled.reason === "missing") {
      deps.logger.error(
        { matchId: params.matchId, missing: assembled.missing },
        "scout_report_agent_missing_sections",
      );
      throw new Error(
        `Report agent finished without calling required sections: ${assembled.missing.join(", ")}.`,
      );
    }
    deps.logger.error(
      { matchId: params.matchId, schemaError: assembled.message },
      "scout_report_agent_schema_invalid",
    );
    throw new Error(
      `Report agent emitted content that failed shared-schema validation: ${assembled.message}`,
    );
  }

  deps.logger.info(
    {
      matchId: params.matchId,
      citations: citations.size(),
      ms: Date.now() - startedAt,
    },
    "scout_report_agent_done",
  );

  return {
    content: assembled.content,
    chartSpecs: accumulator.chartSpecsSnapshot(),
  };
}
