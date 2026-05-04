import { anthropic } from "@ai-sdk/anthropic";
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
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import type { VoyageClient } from "./facts/voyage.ts";
import { SCOUT_SYSTEM_PROMPT } from "./system-prompt.ts";
import { createScoutCache } from "./tools/cache.ts";
import { createChartTool } from "./tools/chart.ts";
import { createDbTools } from "./tools/db.ts";
import { createFactTools } from "./tools/facts.ts";
import { createPlayCricketCitationTools } from "./tools/play-cricket-citations.ts";
import { createPlayCricketTools } from "./tools/play-cricket.ts";
import { createWeatherTools } from "./tools/weather.ts";

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
}

export interface ScoutAgent {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
  prepareStep: (args: { messages: ModelMessage[] }) => {
    messages: ModelMessage[];
  };
}

export function createScoutAgent(deps: ScoutAgentDeps): ScoutAgent {
  const cache = createScoutCache(deps.db);
  const playCricketTools = createPlayCricketTools({
    playCricket: deps.playCricket,
    cache,
    logger: deps.logger,
  });
  const dbTools = createDbTools({ dbReadonly: deps.dbReadonly });
  const weatherTools = createWeatherTools({ cache });
  const chartTools = createChartTool({ writer: deps.writer });
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

  const todayLine = `Today is ${dayName} ${iso} (${ddmmyyyy} in dd/mm/yyyy, the format Play Cricket uses). The current season is ${today.getFullYear()}; default to it when the user doesn't specify a year.

When asked about the "next" or "upcoming" match, filter match_date strictly GREATER THAN ${ddmmyyyy} — anything on or before today has already been played (or is being played now). Don't trust your gut on what day-of-week a date falls on; always compare against the iso date above.`;

  return {
    model: anthropic(deps.config.SCOUT_MODEL_CHAT),
    system: `${SCOUT_SYSTEM_PROMPT}\n\n${todayLine}`,
    tools: {
      ...playCricketTools,
      ...dbTools,
      ...weatherTools,
      ...chartTools,
      ...factTools,
      ...playCricketCitationTools,
    },
    maxSteps: deps.config.SCOUT_MAX_STEPS,
    prepareStep: ({ messages }) => ({
      messages: addCacheControlToLastMessage(messages),
    }),
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
