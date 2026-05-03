import type { DB } from "@percy-main/db";
import type { ModelMessage, UIMessage } from "ai";
import type { Kysely } from "kysely";
import { formatFactsBlock, retrieveFacts } from "./service.ts";
import type { VoyageClient } from "./voyage.ts";

/**
 * Pre-turn auto-retrieval: pull the most relevant facts for the current
 * user turn and inject them into the model-message side of the prompt.
 *
 * Conversation-aware query: concatenate the last 2 user-message texts +
 * the current one as the retrieval query. Cheap mitigation for anaphora
 * ("what about them?") without spending a Haiku call on query rewrite.
 *
 * The injection lands as an extra text part appended to the last user
 * message, AFTER convertToModelMessages. That keeps the persisted user
 * message clean (the DB shouldn't contain the auto-retrieved block) and
 * it keeps the cache-control breakpoint on the last message — Anthropic
 * caches the prefix up to and including the facts block on creation, and
 * subsequent agentic steps in the same turn read it from cache.
 */

const QUERY_HISTORY_TURNS = 2;

export interface AutoRetrieveDeps {
  db: Kysely<DB>;
  voyage: VoyageClient;
  userId: string;
}

export interface AutoRetrieveResult {
  /** Mutated message list (a fresh array; inputs are not mutated). */
  messages: ModelMessage[];
  /** The block injected, for logging. Empty string if no facts found. */
  factsBlock: string;
  factsCount: number;
}

export async function applyAutoRetrieval(
  deps: AutoRetrieveDeps,
  uiMessages: UIMessage[],
  modelMessages: ModelMessage[],
): Promise<AutoRetrieveResult> {
  const query = buildQuery(uiMessages);
  if (!query) {
    return { messages: modelMessages, factsBlock: "", factsCount: 0 };
  }

  const retrieve = retrieveFacts(deps.db, deps.voyage);
  const facts = await retrieve({ userId: deps.userId, query });

  const block = formatFactsBlock(facts);
  if (!block) {
    return { messages: modelMessages, factsBlock: "", factsCount: 0 };
  }

  return {
    messages: appendBlockToLastUserMessage(modelMessages, block),
    factsBlock: block,
    factsCount: facts.length,
  };
}

function buildQuery(messages: UIMessage[]): string {
  const userTexts: string[] = [];
  for (
    let i = messages.length - 1;
    i >= 0 && userTexts.length < QUERY_HISTORY_TURNS + 1;
    i--
  ) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      .trim();
    if (text) userTexts.unshift(text);
  }
  return userTexts.join("\n").trim();
}

function appendBlockToLastUserMessage(
  messages: ModelMessage[],
  block: string,
): ModelMessage[] {
  if (messages.length === 0) return messages;
  return messages.map((message, index) => {
    if (index !== messages.length - 1) return message;
    if (message.role !== "user") return message;

    // ModelMessage.content is `string | Array<TextPart | ImagePart | FilePart>`.
    // Normalise to the array form so we can append cleanly without
    // clobbering image/file parts the user might have attached.
    const existing = Array.isArray(message.content)
      ? message.content
      : [{ type: "text" as const, text: message.content }];

    return {
      ...message,
      content: [...existing, { type: "text" as const, text: `\n\n${block}` }],
    };
  });
}
