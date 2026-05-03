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
    tools: { ...playCricketTools, ...dbTools },
    maxSteps: deps.config.SCOUT_MAX_STEPS,
  };
}
