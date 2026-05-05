import type { DB } from "@percy-main/db";
import { generateText, stepCountIs } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../../config.ts";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { resolveModel } from "../provider.ts";
import { GROUNDING_RULES, IMPORTANT_CONTEXT } from "../system-prompt.ts";
import { createAskDbTool } from "../tools/ask-db.ts";
import { createAskPlayCricketTool } from "../tools/ask-play-cricket.ts";
import { createScoutCache } from "../tools/cache.ts";
import { createFactTools } from "../tools/facts.ts";
import { createRecordEvidenceTool } from "../tools/record-evidence.ts";
import { createWeatherTools } from "../tools/weather.ts";
import { EvidenceAccumulator, type EvidenceRecord } from "./evidence.ts";

export interface ResearchScoutReportParams {
  matchId: string;
  ourTeam: string;
  opposition: string;
  homeAway: "home" | "away";
  matchDate: string;
  competition?: string;
  intent?: string;
}

export interface ResearcherStepInfo {
  step: number;
  toolNames: string[];
  recordsSoFar: number;
  elapsedMs: number;
}

export interface ResearchScoutReportDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  voyage?: VoyageClient;
  userId: string;
  logger?: FastifyBaseLogger;
  /** Optional progress callback — fires after each agent step. The
   *  generate_report tool wires this to a data-report writer so the FE can
   *  show fly-out tool-call chips during the researcher phase. */
  onStep?: (info: ResearcherStepInfo) => void;
}

const RESEARCHER_PROMPT = `You are the RESEARCHER phase inside Scout — a cricket-analysis system for Percy Main CC, a Saturday-league side in the Northumberland and Tyneside Cricket League (NTCL).

Your single job: gather data about ONE upcoming match and emit it as a stream of EvidenceRecord entries via the record_evidence tool. You produce no narrative. You write no analysis. You make no tactical recommendations. The analyst phase that runs after you does ALL of that — your output is the raw evidence packet it works from.

Output channel:
- The ONLY way evidence reaches the analyst is via record_evidence tool calls. Your final assistant text is discarded.
- Call record_evidence repeatedly — once per atomic piece of data. Don't batch.
- Every record needs sourceType, sourceRef, claimType, content, confidence, permanence. See the tool description for the full shape.
- The accumulator dedupes on (sourceRef + content); you can re-emit safely.

What to gather (in roughly this order):

1. Selection / our players. ask_db for "the selected XI for match <matchId> with their season batting averages, bowling figures, and last-6-innings scores". Emit one db_aggregate record per stat that matters (per-player avg, recent runs, wickets/economy). Emit a db_row for the team selection (one record listing the XI).

2. Opposition recent form. ask_play_cricket for the opposition's recent fixtures with full scorecards — e.g. "Get scorecards for <Opposition>'s last 4-5 league matches in <season> on site_id <id>; I need every batter's name, runs, balls, how_out, and every bowler's overs/maidens/runs/wickets." That single call returns N pc_match_detail entries in \`calls\`, each with the full innings.bat[] and innings.bowl[] arrays. Emit one pc_match record per match's headline output. Then derive per-player aggregates yourself across those scorecards — total runs, average, total wickets, economy, dismissal-mode frequencies — and emit one pc_aggregate record per player whose career-across-these-matches is worth scouting (top scorers, leading wicket-takers). Where applicable, emit a dismissal_pattern record summarising how_out frequencies ("5 of his 8 dismissals this season are bowled or LBW").

3. Weather. ask_play_cricket "what's the ground latitude/longitude for match <matchId>" if you don't already have it, then weather_get with that lat/lng. Skip if matchDate > 7 days from today (forecast unreliable). One weather record summarising the headline conditions.

4. Facts. fact_retrieve for opposition / venue / scheduling / mechanics facts the captain or club has previously recorded. Emit a captain_fact or club_fact record per relevant fact (preserve scope — if the fact came back tagged scope=user, it's captain_fact; scope=club, it's club_fact).

When to stop: when the gathering above is exhausted for this match. The model loop will also terminate at the configured step ceiling. There's no "I'm done" tool call — just stop emitting record_evidence calls and stop running tools.

Hard rules — these are not negotiable:

- DO NOT call record_evidence with content that contains analysis, recommendations, or tactical prose. content is one short factual sentence describing what the data says. Examples:
  GOOD: "Dance took 5/27 in 8 overs for Newcastle 1st XI vs Tynemouth on 18 May 2026."
  GOOD: "Captain has recorded: 'Mitford CC have no covers.'"
  BAD:  "Dance is dangerous because his 5-for came from full straight bowling — bowl into him." (analysis + invented mechanics)
  BAD:  "We should target their middle order with spin." (recommendation — analyst's job)

- DO NOT invent mechanics. If ask_play_cricket returns a wicket count, the content describes that count. It does NOT include line, length, movement, footwork, shot, field placement, glovework, or captaincy claims unless you got that info from fact_retrieve as a recorded fact.

- DO NOT call fact_record (you're not interviewing anyone) or cite_fact / cite_match / cite_player_stats (those emit FE chips that don't apply here) or chart_render (chart synthesis is the analyst's job).

- claimType MATTERS. The analyst's validator uses it to gate mechanics claims. Be honest:
  * stats / scorecard data → db_aggregate, db_row, pc_aggregate, pc_match, dismissal_pattern
  * fact_retrieve scope=user → captain_fact
  * fact_retrieve scope=club → club_fact
  * weather → weather

${GROUNDING_RULES}

${IMPORTANT_CONTEXT}

Final reminder: the only output that survives this phase is record_evidence tool calls. No prose, no JSON. Gather, record, stop.
`;

/**
 * Phase 1 — gather evidence for a single match. Runs an internal model loop
 * with the data tools (ask_db, pc_*, weather_get, fact_retrieve) plus the
 * record_evidence tool. Returns the EvidenceRecord array the accumulator
 * built up.
 *
 * No FE writer is plumbed in: this loop's tool calls and assistant text never
 * cross the SSE boundary. The user sees only the data-report placeholder
 * card while this runs.
 */
export async function researchScoutReport(
  deps: ResearchScoutReportDeps,
  params: ResearchScoutReportParams,
): Promise<EvidenceRecord[]> {
  const accumulator = new EvidenceAccumulator();

  const cache = createScoutCache(deps.db);
  // Researcher uses the ask_* sub-agents for the same reason the chat agent
  // does — projection mistakes and SQL/API loops stay out of this phase's
  // context, leaving room for the evidence packet itself.
  const playCricketTool = createAskPlayCricketTool({
    playCricket: deps.playCricket,
    db: deps.db,
    provider: deps.config.SCOUT_PROVIDER_PC,
    modelId: deps.config.SCOUT_MODEL_PC,
    maxSteps: deps.config.SCOUT_PC_AGENT_MAX_STEPS,
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

  // Researcher gets fact_retrieve only — no fact_record (writes corpus, not
  // researcher's job) and no cite_* (FE chips, irrelevant in this phase).
  let factRetrieveTool = {} as Record<string, unknown>;
  if (deps.voyage) {
    // Researcher only ever uses fact_retrieve which doesn't touch the
    // writer; the noop methods are present purely to satisfy the
    // FactToolDeps shape required by createFactTools.
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
    factRetrieveTool = { fact_retrieve: allFactTools.fact_retrieve };
  }

  const recordEvidenceTool = createRecordEvidenceTool({ accumulator });

  const tools = {
    ...playCricketTool,
    ...dbTools,
    ...weatherTools,
    ...factRetrieveTool,
    ...recordEvidenceTool,
  };

  const resolved = resolveModel(
    deps.config.SCOUT_PROVIDER_RESEARCHER,
    deps.config.SCOUT_MODEL_RESEARCHER,
  );

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const todayDisplay = today.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const promptBlock = `MATCH SCOPE — research only this match:
- matchId: ${params.matchId}
- ourTeam: ${params.ourTeam}
- opposition: ${params.opposition}
- homeAway: ${params.homeAway}
- matchDate: ${params.matchDate}
- competition: ${params.competition ?? "(not specified)"}
- intent: ${params.intent ?? "(general scout — gather a balanced packet)"}

Today is ${todayDisplay} (${todayIso}). Use this for relative-date filters and the weather-horizon decision.

Gather the evidence packet now. Emit each piece via record_evidence. Do not narrate, do not synthesize.`;

  const startedAt = Date.now();
  deps.logger?.info(
    {
      matchId: params.matchId,
      maxSteps: deps.config.SCOUT_RESEARCHER_MAX_STEPS,
      timeoutMs: deps.config.SCOUT_RESEARCHER_TIMEOUT_MS,
    },
    "scout_researcher_started",
  );

  let stepIndex = 0;
  try {
    await generateText({
      model: resolved.model,
      system: RESEARCHER_PROMPT,
      prompt: promptBlock,
      tools,
      stopWhen: stepCountIs(deps.config.SCOUT_RESEARCHER_MAX_STEPS),
      // Hard wall-clock cap. Without this a slow DeepSeek thinking step holds
      // the whole flow open indefinitely (observed: a single step blocking
      // for 4+ minutes with no visible progress).
      abortSignal: AbortSignal.timeout(deps.config.SCOUT_RESEARCHER_TIMEOUT_MS),
      // Per-step log so we can see which step is wedged when one drags. Logs
      // step duration + tool-call names + accumulator size after the step.
      onStepFinish: ({ toolCalls, finishReason }) => {
        stepIndex += 1;
        const toolNames = toolCalls.map((c) => c.toolName);
        const elapsedMs = Date.now() - startedAt;
        deps.logger?.info(
          {
            matchId: params.matchId,
            step: stepIndex,
            toolCalls: toolNames,
            finishReason,
            recordsSoFar: accumulator.size(),
            elapsedMs,
          },
          "scout_researcher_step",
        );
        deps.onStep?.({
          step: stepIndex,
          toolNames,
          recordsSoFar: accumulator.size(),
          elapsedMs,
        });
      },
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    deps.logger?.error(
      {
        matchId: params.matchId,
        err,
        isTimeout,
        stepsCompleted: stepIndex,
        recordsSoFar: accumulator.size(),
        elapsedMs: Date.now() - startedAt,
      },
      "scout_researcher_failed",
    );
    if (isTimeout) {
      throw new Error(
        `Researcher phase timed out after ${deps.config.SCOUT_RESEARCHER_TIMEOUT_MS}ms (${stepIndex} steps completed, ${accumulator.size()} records gathered).`,
        { cause: err },
      );
    }
    throw err;
  }

  const evidence = accumulator.snapshot();
  deps.logger?.info(
    {
      matchId: params.matchId,
      records: evidence.length,
      steps: stepIndex,
      ms: Date.now() - startedAt,
    },
    "scout_researcher_done",
  );

  if (evidence.length === 0) {
    throw new Error(
      "Researcher emitted no evidence records — cannot proceed to analyst phase.",
    );
  }

  return evidence;
}
