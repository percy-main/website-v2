import type { Tracer } from "@opentelemetry/api";
import type { DB } from "@percy-main/db";
import { generateText } from "ai";
import type { Kysely } from "kysely";
import { resolveModel, type ScoutProvider } from "./provider.ts";
import { buildPhoenixTelemetry } from "./telemetry.ts";

const TITLE_PROMPT =
  "Title this scouting query in 4 words or fewer. Reply with just the title - no quotes, no punctuation.";

const DEFAULT_TITLE = "New thread";

export interface TitleDeps {
  db: Kysely<DB>;
  provider: ScoutProvider;
  modelId: string;
  phoenixTracer: Tracer;
}

/**
 * If the thread still has the placeholder title and we now have at least
 * one user message, ask the configured sub-agent for a 4-word title and
 * overwrite it. Best effort — failures are swallowed (the placeholder
 * remains) so a title gen blip can't break a chat turn.
 */
export function maybeGenerateTitle(deps: TitleDeps) {
  const { model } = resolveModel(deps.provider, deps.modelId);
  return async (threadId: string, firstUserText: string): Promise<void> => {
    const thread = await deps.db
      .selectFrom("scout_thread")
      .where("id", "=", threadId)
      .select(["title"])
      .executeTakeFirst();

    if (thread?.title !== DEFAULT_TITLE) return;
    if (!firstUserText.trim()) return;

    try {
      const result = await generateText({
        model,
        prompt: `${TITLE_PROMPT}\n\nQuery: ${firstUserText.slice(0, 500)}`,
        experimental_telemetry: buildPhoenixTelemetry(
          deps.phoenixTracer,
          "scout.title",
        ),
      });
      const title = result.text
        .trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 80);
      if (!title) return;

      await deps.db
        .updateTable("scout_thread")
        .set({ title })
        .where("id", "=", threadId)
        .where("title", "=", DEFAULT_TITLE)
        .execute();
    } catch {
      // Title gen is best-effort. Leave the placeholder if it fails.
    }
  };
}
