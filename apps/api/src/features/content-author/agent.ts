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
import { resolveModel } from "../scout/provider.ts";
import { createScoutCache } from "../scout/tools/cache.ts";
import { createDbTools } from "../scout/tools/db.ts";
import { createPlayCricketTools } from "../scout/tools/play-cricket.ts";
import { createWeatherTools } from "../scout/tools/weather.ts";
import {
  buildContentAuthorSystemPrompt,
  type EditorContext,
} from "./system-prompt.ts";
import { createWriteContentTool } from "./tools/write-content.ts";

// streamText's providerOptions is a deep alias not re-exported from "ai"
// (SharedV3ProviderOptions). Inline the structural shape - we only ever build
// one nested object keyed by provider id. Mirrors scout/agent.ts.
type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];
type ProviderOptions = Record<string, Record<string, JsonValue>>;

// Reasoning is always on for this agent (the feature requires it). Anthropic's
// thinking needs headroom under maxOutputTokens, so we set both and keep the
// budget comfortably below the cap. Content turns can be long (heading + intro
// + several blocks across steps), so the cap is generous.
const MAX_OUTPUT_TOKENS = 16_000;
const ANTHROPIC_THINKING_BUDGET = 6_000;

export interface ContentAuthorAgentDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  // Stream writer used by write_content to emit data-content-blocks parts.
  writer: UIMessageStreamWriter;
  logger: FastifyBaseLogger;
  // Editor state injected into the system prompt to ground research.
  editorContext: EditorContext;
}

export interface ContentAuthorAgent {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
  maxOutputTokens: number;
  prepareStep: (args: { messages: ModelMessage[] }) => {
    messages: ModelMessage[];
  };
  providerOptions: ProviderOptions;
}

export function createContentAuthorAgent(
  deps: ContentAuthorAgentDeps,
): ContentAuthorAgent {
  // Reuse Scout's data tool factories directly - they are self-contained
  // curried factories. The cache is shared between Play Cricket and weather
  // tools so a multi-step authoring flow reuses cached API responses.
  const cache = createScoutCache(deps.db);
  const playCricketTools = createPlayCricketTools({
    playCricket: deps.playCricket,
    cache,
    logger: deps.logger,
  });
  const dbTools = createDbTools({ dbReadonly: deps.dbReadonly });
  const weatherTools = createWeatherTools({ cache });
  const writeContentTools = createWriteContentTool({ writer: deps.writer });

  const resolved = resolveModel(
    deps.config.CONTENT_AI_PROVIDER,
    deps.config.CONTENT_AI_MODEL,
  );

  // DeepSeek reasons by default; pass enabled explicitly so the intent is
  // clear. Anthropic exposes an explicit extended-thinking budget.
  const providerOptions: ProviderOptions =
    resolved.provider === "deepseek"
      ? { deepseek: { thinking: { type: "enabled" } } }
      : {
          anthropic: {
            thinking: {
              type: "enabled",
              budgetTokens: ANTHROPIC_THINKING_BUDGET,
            },
          },
        };

  return {
    model: resolved.model,
    system: buildContentAuthorSystemPrompt(deps.editorContext),
    tools: {
      ...playCricketTools,
      ...dbTools,
      ...weatherTools,
      ...writeContentTools,
    },
    maxSteps: deps.config.SCOUT_MAX_STEPS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    prepareStep: ({ messages }) => ({
      messages: resolved.supportsAnthropicCacheControl
        ? addCacheControlToLastMessage(messages)
        : messages,
    }),
    providerOptions,
  };
}

/**
 * Mark the most recent message with Anthropic's ephemeral cacheControl so the
 * prefix-up-to-here is cached across agentic steps. No-op for DeepSeek (it
 * caches prefixes automatically). Lifted from scout/agent.ts.
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
