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

  return {
    model: anthropic(deps.config.SCOUT_MODEL_CHAT),
    system: SCOUT_SYSTEM_PROMPT,
    tools: { ...playCricketTools, ...dbTools },
    maxSteps: deps.config.SCOUT_MAX_STEPS,
  };
}
