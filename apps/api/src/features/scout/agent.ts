import type { DB } from "@percy-main/db";
import type {
  LanguageModel,
  ModelMessage,
  ToolSet,
  UIMessageStreamWriter,
} from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../config.ts";
import type { ScoutReportStore } from "../../lib/s3-scout-reports.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import type { VoyageClient } from "./facts/voyage.ts";
import { resolveModel } from "./provider.ts";
import type { ScoutMode } from "./schemas.ts";
import {
  SCOUT_DEBRIEF_SYSTEM_PROMPT,
  SCOUT_FOCUSED_SYSTEM_PROMPT,
  SCOUT_SYSTEM_PROMPT,
} from "./system-prompt.ts";
import { createAskDbTool } from "./tools/ask-db.ts";
import { createAskPlayCricketTool } from "./tools/ask-play-cricket.ts";
import { createAskQuestionTool } from "./tools/ask-question.ts";
import { createScoutCache } from "./tools/cache.ts";
import { createChartTool } from "./tools/chart.ts";
import { createFactTools } from "./tools/facts.ts";
import { createGenerateReportTool } from "./tools/generate-report.ts";
import { createPlayCricketCitationTools } from "./tools/play-cricket-citations.ts";
import { createWeatherTools } from "./tools/weather.ts";

// streamText's providerOptions is typed as a deep alias not re-exported from
// the public "ai" entrypoint (lives in @ai-sdk/provider as
// SharedV3ProviderOptions). Inline the structural shape — the only thing we
// ever build is one nested object keyed by provider id, so a JSONValue tree
// is sufficient and avoids reaching into a transitive dep.
type ScoutJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: ScoutJsonValue }
  | ScoutJsonValue[];
type ScoutProviderOptions = Record<string, Record<string, ScoutJsonValue>>;

/**
 * Scout's agent config — model, system prompt, and the tool dictionary that
 * gets passed to AI SDK v6's streamText / generateText. We use AI SDK
 * directly because v6's UIMessageStream bridges cleanly to the v6 frontend
 * useChat. Mastra was evaluated and dropped: its MastraModelOutput doesn't
 * expose a v6-compatible UIMessageStream and we didn't need its sub-agent /
 * durable workflow features for v1.
 */
export interface ScoutAgentDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  // Stream writer used by chart_render to emit data-chart parts inline with
  // the assistant's prose. The route wraps streamText in createUIMessageStream
  // and passes the resulting writer down.
  writer: UIMessageStreamWriter;
  logger?: FastifyBaseLogger;
  // Fact-RAG dependencies. Optional so the agent can boot without a Voyage
  // API key — the fact_record / fact_retrieve tools are simply omitted in
  // that case. userId is the authenticated caller; threadId is attached to
  // every recorded fact for traceability.
  voyage?: VoyageClient;
  userId: string;
  threadId?: string;
  // Interaction mode — fixed at thread creation. Picks system prompt and
  // toggles the ask_question / chart_render tool surface (debrief uses
  // ask_question and skips charts; scouting is the inverse).
  mode: ScoutMode;
  // S3 store for the generate_report tool. Required in scouting mode (the
  // only mode where the tool is registered); ignored in debrief.
  scoutReports: ScoutReportStore;
  // Per-turn reasoning toggle. "thinking" = chain-of-thought enabled (slower,
  // better on multi-step queries); "fast" = thinking disabled (lower latency,
  // best for follow-ups). Only DeepSeek currently honours this — Sonnet 4.6
  // has no native thinking knob, so the flag is a no-op when chat provider
  // is anthropic.
  thinkingMode: ThinkingMode;
}

export type ThinkingMode = "thinking" | "fast";

export interface ScoutAgent {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
  prepareStep: (args: { messages: ModelMessage[] }) => {
    messages: ModelMessage[];
  };
  // Provider-specific options merged into streamText. Currently only used to
  // toggle DeepSeek's thinking mode per turn; empty for anthropic runs.
  providerOptions: ScoutProviderOptions;
}

export function createScoutAgent(deps: ScoutAgentDeps): ScoutAgent {
  const cache = createScoutCache(deps.db);
  // The main agent gets a single ask_play_cricket tool, not the raw pc_*
  // surface. Failed projections, the site_id pivot chain, and the
  // status-vs-match_date trap all stay inside the sub-agent's loop —
  // see tools/ask-play-cricket.ts for the full rationale. The sub-agent
  // owns its own ScoutCache instance internally.
  const playCricketTool = createAskPlayCricketTool({
    playCricket: deps.playCricket,
    db: deps.db,
    provider: deps.config.SCOUT_PROVIDER_PC,
    modelId: deps.config.SCOUT_MODEL_PC,
    maxSteps: deps.config.SCOUT_PC_AGENT_MAX_STEPS,
    logger: deps.logger,
  });
  // The main agent gets a single ask_db tool, not the raw SQL surface.
  // Failed queries, schema dumps, and intermediate row samples stay inside
  // the sub-agent's loop — see tools/ask-db.ts for the full rationale.
  const dbTools = createAskDbTool({
    dbReadonly: deps.dbReadonly,
    provider: deps.config.SCOUT_PROVIDER_DB,
    modelId: deps.config.SCOUT_MODEL_DB,
    maxSteps: deps.config.SCOUT_DB_AGENT_MAX_STEPS,
    logger: deps.logger,
  });
  const weatherTools = createWeatherTools({ cache });
  // Charts are useful in chat / scout answers but out of place in a debrief
  // interview — register chart_render for the two scouting-shaped modes only.
  const chartTools =
    deps.mode === "chat" || deps.mode === "scout"
      ? createChartTool({ writer: deps.writer })
      : {};
  // generate_report builds a PDF and stores it in S3. Relevant in chat (the
  // captain may ask) and scout (the focused mode self-triggers the tool); not
  // in debrief, which surfaces a structured interview rather than a document.
  // threadId is required to file reports against the owning thread, so we
  // only register the tool when one is present.
  //
  // The tool runs a researcher sub-agent INTERNALLY to compile the report
  // payload — the main agent never has to stream the structured JSON itself.
  // We pass the researcher its own dependencies (model + tool surface) here.
  const reportTools =
    (deps.mode === "chat" || deps.mode === "scout") && deps.threadId
      ? createGenerateReportTool({
          db: deps.db,
          dbReadonly: deps.dbReadonly,
          playCricket: deps.playCricket,
          config: deps.config,
          voyage: deps.voyage,
          scoutReports: deps.scoutReports,
          writer: deps.writer,
          userId: deps.userId,
          threadId: deps.threadId,
          logger: deps.logger,
        })
      : {};
  // ask_question is the inverse: only in debrief, where the agent walks
  // the captain through structured prompts via inline button cards.
  const askQuestionTools =
    deps.mode === "debrief"
      ? createAskQuestionTool({ writer: deps.writer })
      : {};
  // Match / player-stats citation tools — companions to cite_fact. They
  // don't need the DB or any external client, only the writer to stream
  // data-*-citation parts to the FE alongside the assistant's prose.
  const playCricketCitationTools = createPlayCricketCitationTools({
    writer: deps.writer,
  });
  // Fact tools only register when Voyage is configured. Auto-retrieval in
  // the route also short-circuits in that case, so a deployment without
  // VOYAGE_API_KEY behaves as if the RAG layer doesn't exist.
  const factTools = deps.voyage
    ? createFactTools({
        db: deps.db,
        voyage: deps.voyage,
        userId: deps.userId,
        threadId: deps.threadId,
        // Same writer the chart tool uses — cite_fact emits
        // data-fact-citation parts inline with assistant prose.
        writer: deps.writer,
        // Used to log raw Voyage error bodies server-side without
        // surfacing them to the model.
        logger: deps.logger,
      })
    : {};

  // Anchor "today" so the model doesn't fall back to its training cutoff
  // when picking a default season AND so it filters past/future matches
  // correctly. Resolved per-request, not at module load.
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const dayName = today.toLocaleDateString("en-GB", { weekday: "long" });
  const ddmmyyyy = today.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const todayLine = `Today is ${dayName} ${iso}. The current season is ${today.getFullYear()}; default to it when the user doesn't specify a year.

Date formats are split between sources:
- The Play Cricket *API* (queried via ask_play_cricket) emits dd/mm/yyyy — today is ${ddmmyyyy} in that format. The sub-agent handles the dates for you; if you see them in returned \`data\`, treat dd/mm/yyyy as the canonical form there.
- Our *database* (queried via ask_db) stores match_date as ISO ${iso}-style. Lex order = chronological order.

When asked about the "next" or "upcoming" match, the answer is in the local DB — ask_db with match_date > '${iso}'. Anything on or before today has already been played (or is being played now). Don't trust your gut on what day-of-week a date falls on; always compare against the iso date above.`;

  const basePrompt =
    deps.mode === "debrief"
      ? SCOUT_DEBRIEF_SYSTEM_PROMPT
      : deps.mode === "scout"
        ? SCOUT_FOCUSED_SYSTEM_PROMPT
        : SCOUT_SYSTEM_PROMPT;

  const resolved = resolveModel(
    deps.config.SCOUT_PROVIDER_CHAT,
    deps.config.SCOUT_MODEL_CHAT,
  );

  // DeepSeek-v4-pro defaults to thinking-on. Sending an explicit
  // { type: "disabled" } through providerOptions skips the chain-of-thought
  // pass for fast follow-ups. Anthropic doesn't expose a knob like this on
  // Sonnet 4.6, so we leave its options empty regardless of the toggle.
  const providerOptions: ScoutProviderOptions =
    resolved.provider === "deepseek"
      ? {
          deepseek: {
            thinking: {
              type: deps.thinkingMode === "fast" ? "disabled" : "enabled",
            },
          },
        }
      : {};

  return {
    model: resolved.model,
    system: `${basePrompt}\n\n${todayLine}`,
    tools: {
      ...playCricketTool,
      ...dbTools,
      ...weatherTools,
      ...chartTools,
      ...reportTools,
      ...askQuestionTools,
      ...factTools,
      ...playCricketCitationTools,
    },
    maxSteps: deps.config.SCOUT_MAX_STEPS,
    prepareStep: ({ messages }) => ({
      messages: resolved.supportsAnthropicCacheControl
        ? addCacheControlToLastMessage(messages)
        : messages,
    }),
    providerOptions,
  };
}

/**
 * Mark the most recent message with Anthropic's ephemeral cacheControl so
 * the prefix-up-to-here is cached. Each agentic step moves the breakpoint
 * forward, so by step N the previous N-1 steps' content is being read from
 * cache (~10% cost) instead of paid as fresh input. With our heavy Play
 * Cricket tool results, this is the difference between paying for a 50KB
 * payload once vs. on every subsequent step in the loop.
 *
 * Pattern lifted from the AI SDK v6 dynamic-prompt-caching cookbook —
 * marking only the last message is sufficient because Anthropic caches
 * incrementally up to the breakpoint.
 */
function addCacheControlToLastMessage(
  messages: ModelMessage[],
): ModelMessage[] {
  if (messages.length === 0) return messages;
  return messages.map((message, index) => {
    if (index !== messages.length - 1) return message;
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    };
  });
}
