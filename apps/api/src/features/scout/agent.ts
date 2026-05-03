import { anthropic } from "@ai-sdk/anthropic";
import type { DB } from "@percy-main/db";
import type { LanguageModel, ToolSet } from "ai";
import type { Kysely } from "kysely";
import type { Config } from "../../config.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import { SCOUT_SYSTEM_PROMPT } from "./system-prompt.ts";
import { createScoutCache } from "./tools/cache.ts";
import { createDbTools } from "./tools/db.ts";
import { createPlayCricketTools } from "./tools/play-cricket.ts";

/**
 * Scout's agent config — model, system prompt, and the tool dictionary that
 * gets passed to AI SDK v6's streamText / generateText. We deliberately use
 * the AI SDK directly here (rather than @mastra/core's Agent) because Mastra's
 * stream output doesn't expose a UIMessageStream that bridges cleanly to the
 * v6 frontend useChat. Mastra remains installed for future sub-agent / durable
 * workflow needs but isn't load-bearing for v1.
 */
export interface ScoutAgentDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
}

export interface ScoutAgent {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
}

export function createScoutAgent(deps: ScoutAgentDeps): ScoutAgent {
  const cache = createScoutCache(deps.db);
  const playCricketTools = createPlayCricketTools({
    playCricket: deps.playCricket,
    cache,
  });
  const dbTools = createDbTools({ dbReadonly: deps.dbReadonly });

  // Anchor "today" so the model doesn't fall back to its training cutoff
  // when picking a default season. Resolved per-request, not at module load.
  const today = new Date();
  const todayLine = `Today is ${today.toISOString().slice(0, 10)} (${today.getFullYear()} season). When the user asks about "this season" or doesn't specify a year, use ${today.getFullYear()}.`;

  return {
    model: anthropic(deps.config.SCOUT_MODEL_CHAT),
    system: `${SCOUT_SYSTEM_PROMPT}\n\n${todayLine}`,
    tools: { ...playCricketTools, ...dbTools },
    maxSteps: deps.config.SCOUT_MAX_STEPS,
  };
}
