import type { DB } from "@percy-main/db";
import { tool, type UIMessageStreamWriter } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  factScopeSchema,
  factTagsSchema,
  recordFact,
  retrieveFacts,
  type RetrievedFact,
} from "../facts/service.ts";
import { VoyageError, type VoyageClient } from "../facts/voyage.ts";

/**
 * Wrap a fact-tool execute body so VoyageErrors degrade into a sanitised
 * tool result instead of bubbling up. The raw provider response (which
 * contains billing copy, dashboard URLs, account hints) is logged for
 * the operator but never reaches the model or the user.
 */
async function withVoyageGuard<T>(
  logger: FastifyBaseLogger | undefined,
  toolName: string,
  fn: () => Promise<T>,
): Promise<T | { recorded: false; error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof VoyageError) {
      logger?.error(
        {
          tool: toolName,
          status: err.status,
          endpoint: err.endpoint,
          detail: err.detail,
        },
        "scout fact tool: voyage call failed",
      );
      return { recorded: false as const, error: err.message };
    }
    throw err;
  }
}

/**
 * Scout's fact-RAG tools. Bound to the user_id of the caller so the
 * agent can't accidentally read or write facts for someone else, and
 * scoped via the `scope` argument on `fact_record` to distinguish
 * personal preferences from shared club knowledge.
 *
 * Pre-turn auto-retrieval already injects a top-K facts block into each
 * user message, so `fact_retrieve` is only useful when the agent wants
 * to dig deeper mid-turn (more results, tag filter, narrower query).
 *
 * `cite_fact` is the citation primitive: when the agent grounds a claim
 * in a known fact, it calls cite_fact to emit a `data-fact-citation`
 * UIMessage part inline with its prose. The frontend renders these as
 * numbered citation chips and a sources panel — same wiring chart_render
 * uses for `data-chart` parts.
 */

export interface FactToolDeps {
  db: Kysely<DB>;
  voyage: VoyageClient;
  userId: string;
  /** Current thread id, attached to every recorded fact for traceability. */
  threadId?: string;
  /**
   * Optional — when present, cite_fact streams citation parts to the UI.
   * Citations degrade gracefully (the tool still validates and returns a
   * payload the model can read) when no writer is supplied, so unit
   * tests don't need to wire one.
   */
  writer?: UIMessageStreamWriter;
  /**
   * Optional — used to log raw Voyage error bodies server-side. Tool
   * results stay sanitised regardless; this just controls whether the
   * raw `detail` lands in pino for operator triage.
   */
  logger?: FastifyBaseLogger;
}

export function createFactTools(deps: FactToolDeps) {
  const { db, voyage, userId, threadId, writer, logger } = deps;
  const record = recordFact(db, voyage);
  const retrieve = retrieveFacts(db, voyage);

  return {
    fact_record: tool({
      description: `Record a durable fact about a club, ground, player, or the user. Facts persist across conversations and are auto-retrieved on every user turn.

CRITICAL — when the user states a fact for you to remember, fact_record is the FIRST and ONLY tool you call. Do not run db_list_tables, db_run_sql, db_describe_table, or pc_* tools to verify the subject exists, look up player ids, or cross-check the DB before writing the fact. The user has authority over the fact; your job is to write it down. After fact_record returns recorded:true, reply briefly to confirm — never claim storage before the call succeeds, and never claim it succeeded if it returned an error.

When to call:
- The user tells you a piece of domain knowledge: "Mitford CC have no covers", "Saturday games start at 1pm", "Oli Robson — medium/slow, gets movement".
- A personal preference relevant to scouting the speaker: "I hate facing spin", "I open the bowling" → scope: "user".
- The user corrects something you got wrong (record the correction).
- You discover a non-obvious pattern from data worth keeping ("Smith bowled/LBW in 9 of his last 12 dismissals") — this is the only case where DB lookup may precede fact_record.

If the user lists multiple facts in one turn, call fact_record once per fact — don't batch.

When NOT to call:
- Transient state ("we won today") — the data is in the DB already.
- Restating what's already in <known-facts> for this turn.
- Speculation, vibes, or claims you can't ground.

Tags drive retrieval. Use semantic keys: \`team\`, \`venue\`, \`player\`, \`topic\` (e.g. "weather", "scheduling", "kit", "bowling-style", "batting-style"), \`season\`. Values can be strings or arrays. Keep tag values stable — "Oli Robson" not "Oli", "Mitford CC" not "Mitford" — so retrieval matches across turns.

Scope:
- "user" — personal to the speaker (preferences, their own form notes). Only retrievable for that user.
- "club" — shared by everyone with Scout access (ground info, opposition quirks, league rules, our players' bowling/batting profiles).

Confidence is 1–5: 5 = stated outright by the user as fact; 3 = reasonably solid inference; 1 = guess. Be conservative.`,
      inputSchema: z.object({
        content: z
          .string()
          .min(5)
          .max(500)
          .describe(
            "The fact, as a single declarative sentence. e.g. 'Mitford CC have no covers, so wet weeks make their pitch slow and low.'",
          ),
        tags: factTagsSchema
          .optional()
          .describe(
            'Structured tags for retrieval, e.g. {"team":"Mitford CC","topic":"ground"}.',
          ),
        scope: factScopeSchema
          .default("club")
          .describe(
            "'club' (default) for shared knowledge, 'user' for personal preferences.",
          ),
        confidence: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(3)
          .describe(
            "Self-assessed confidence, 1 (guess) to 5 (verbatim user fact).",
          ),
      }),
      execute: ({ content, tags, scope, confidence }) =>
        withVoyageGuard(logger, "fact_record", async () => {
          const result = await record({
            userId,
            scope,
            content,
            tags,
            confidence,
            sourceThreadId: threadId,
          });
          return {
            recorded: true as const,
            id: result.id,
            action: result.action,
            supersededId: result.supersededId,
          };
        }),
    }),

    cite_fact: tool({
      description: `Attach a citation to a claim you just made, grounding it in a specific fact from the <known-facts> block (or one returned by fact_retrieve). Call this immediately after the sentence the citation supports, with the exact factId and the verbatim claim.

When to call:
- You stated something the user told you previously: "Mitford have no covers" → cite_fact(factId, claim).
- You used a tag, ground feature, scheduling rule, or personal preference that came from the fact corpus.
- You want the user to be able to verify a claim — citations render as a sources panel in the UI.

When NOT to call:
- The claim is grounded in DB / Play Cricket / weather data, not a fact (no fact id to cite).
- You're paraphrasing general cricket knowledge, not a recorded fact.
- The fact was an inference of yours that you wouldn't record via fact_record — don't pretend it has a source.

Citations are inexpensive and the user values them — when in doubt, cite. One call per cited fact; the same factId can be cited multiple times across a response if you reference it more than once.`,
      inputSchema: z.object({
        factId: z
          .uuid()
          .describe(
            "The UUID of the fact, exactly as it appears in <known-facts> (the [fact:<uuid>] marker) or as returned by fact_retrieve.",
          ),
        claim: z
          .string()
          .min(3)
          .max(500)
          .describe(
            "The verbatim sentence (or short clause) from your reply that the citation grounds. The frontend uses this to highlight the cited span.",
          ),
      }),
      execute: async ({ factId, claim }) => {
        // Re-check visibility at cite time. The auto-retrieval block was
        // built for the current user_id; if the model somehow citation-ed
        // a factId outside that scope (e.g. one it saw in an earlier
        // thread), the lookup returns nothing and we tell the model so
        // it doesn't render a stale chip.
        const row = await db
          .selectFrom("scout_fact")
          .where("id", "=", factId)
          .where("superseded_by", "is", null)
          .where((eb) =>
            eb.or([eb("user_id", "=", userId), eb("scope", "=", "club")]),
          )
          .select(["id", "content", "tags", "scope", "confidence"])
          .executeTakeFirst();

        if (!row) {
          return {
            cited: false as const,
            error:
              "Fact not found or not visible to this user. Don't invent factIds — only cite ids that appear in <known-facts> or fact_retrieve results.",
          };
        }

        const citationId = randomUUID();
        if (writer) {
          writer.write({
            type: "data-fact-citation",
            id: citationId,
            data: {
              factId: row.id,
              claim,
              content: row.content,
              tags: row.tags as Record<string, string | string[]>,
              scope: row.scope as "user" | "club",
              confidence: row.confidence,
            },
          });
        }

        return {
          cited: true as const,
          citationId,
          factId: row.id,
        };
      },
    }),

    fact_retrieve: tool({
      description: `Search the fact corpus for relevant background knowledge. Pre-turn auto-retrieval already injects the top facts for the user's current message — call this only when you want more results, a specific tag filter, or to query a phrasing the user didn't use.

Useful when:
- You need everything tagged \`team:"Mitford CC"\`, not just the top 5.
- The user mentioned an entity in passing ("Swalwell") and you want to pull all known facts about that ground.
- You want to verify a claim before stating it.`,
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            "Natural-language query, e.g. 'opposition ground conditions Mitford'.",
          ),
        tags: factTagsSchema
          .optional()
          .describe(
            'Optional exact-tag filter, e.g. {"team":"Mitford CC"}. Combined with the query.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .default(8)
          .describe("Max number of facts to return (default 8)."),
      }),
      execute: ({ query, tags, limit }) =>
        withVoyageGuard(logger, "fact_retrieve", async () => {
          const facts = await retrieve({ userId, query, tags, topK: limit });
          return {
            query,
            count: facts.length,
            facts: facts.map(serialiseFact),
          };
        }),
    }),
  };
}

function serialiseFact(f: RetrievedFact) {
  return {
    id: f.id,
    content: f.content,
    tags: f.tags,
    scope: f.scope,
    confidence: f.confidence,
    score: Number(f.score.toFixed(4)),
  };
}

export type FactTools = ReturnType<typeof createFactTools>;
