import type { DB } from "@percy-main/db";
import { tool, type UIMessageStreamWriter } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { S3KnowledgeBaseStore } from "../../../lib/s3-knowledge-base.ts";
import { factTagsSchema } from "../facts/service.ts";
import { VoyageError, type VoyageClient } from "../facts/voyage.ts";
import { searchChunks, type SearchResult } from "../knowledge/service.ts";

/**
 * KB retrieval tools. Bound to the calling user only for logging /
 * audit; KB chunks are club-wide by design and don't carry per-user
 * scoping the way scout_fact does.
 *
 * `knowledge_search` is the primary surface — the agent calls it
 * before answering any policy / handbook / rule question. There's no
 * pre-turn auto-retrieval like fact memory has, because KB chunks are
 * larger and more numerous and shoving them into every turn would
 * balloon context cost.
 *
 * `cite_kb` is the citation primitive: when the agent grounds a claim
 * in a retrieved chunk it calls cite_kb and the streaming UI renders
 * a numbered chip that links back to the document. Same wiring shape
 * as cite_fact and chart_render.
 */

async function withVoyageGuard<T>(
  logger: FastifyBaseLogger | undefined,
  toolName: string,
  fn: () => Promise<T>,
): Promise<T | { count: 0; chunks: []; error: string }> {
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
        "scout KB tool: voyage call failed",
      );
      return { count: 0, chunks: [], error: err.message };
    }
    throw err;
  }
}

export interface KbToolDeps {
  db: Kysely<DB>;
  voyage: VoyageClient;
  store: S3KnowledgeBaseStore;
  /** For audit/logging only — KB chunks are club-wide. */
  userId: string;
  threadId?: string;
  /** Optional UI stream writer; cite_kb streams citation parts when present. */
  writer?: UIMessageStreamWriter;
  logger?: FastifyBaseLogger;
}

export function createKnowledgeTools(deps: KbToolDeps) {
  const { db, voyage, store, writer, logger } = deps;
  const search = searchChunks({
    db,
    voyage,
    store,
    // The KB service caps + URL expiry are unused by searchChunks.
    // They're carried so the same KbDeps shape works for both the
    // route layer and tool layer; we pass dummy non-zero defaults.
    maxDocumentBytes: 1,
    uploadUrlExpirySeconds: 1,
  });

  return {
    knowledge_search: tool({
      description: `Search the club's knowledge base for relevant reference material — handbooks, league rules, policies, set-piece diagrams, scouting reports, photographed pages.

When to call:
- The user asks about a rule, policy, or process — league regs, junior code of conduct, ground booking, fixture protocol.
- You're about to answer a "how do we usually..." or "what does the handbook say..." question.
- The user references a document admins have uploaded ("the new league handbook says...").
- You spotted something in <known-facts> that hints at a documented process and want the canonical wording.

When NOT to call:
- For player-form / ground-conditions / personal-preference questions — those live in the fact corpus (use fact_retrieve).
- For live data (Play-Cricket fixtures, scorecards) — use the pc_* tools.
- When you've already read a chunk for the exact same query in the current turn.

Tags scope retrieval the same way they do for facts. Pass {topic:"rules"} or {team:"Mitford CC"} to narrow. Tag values must match exactly — "Mitford CC" not "Mitford".

Use cite_kb to ground each claim that comes from a returned chunk; otherwise the FE has no citation chip to surface.`,
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            "Natural-language query, e.g. 'powerplay overs in Tier 4 50-over fixtures'.",
          ),
        tags: factTagsSchema
          .optional()
          .describe(
            'Optional exact-tag filter, e.g. {"topic":"rules"} or {"season":"2026"}. Combined with the query.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(6)
          .describe("Max number of chunks to return (default 6)."),
      }),
      execute: ({ query, tags, limit }) =>
        withVoyageGuard(logger, "knowledge_search", async () => {
          const chunks = await search({ query, tags, limit });
          return {
            query,
            count: chunks.length,
            chunks: chunks.map(serialiseChunk),
          };
        }),
    }),

    cite_kb: tool({
      description: `Ground a claim in a knowledge-base chunk. Call this for every sentence sourced from a knowledge_search result so the FE can render a numbered citation chip.

Pass the chunkId from a knowledge_search result, plus the verbatim claim you're making in your prose. Don't invent chunkIds — only cite ids you've seen in a result this turn.`,
      inputSchema: z.object({
        chunkId: z
          .uuid()
          .describe("The chunk id from a knowledge_search result."),
        claim: z
          .string()
          .min(1)
          .max(500)
          .describe("The verbatim claim being grounded in this chunk."),
      }),
      execute: async ({ chunkId, claim }) => {
        // Re-validate the chunk exists at cite time — guards against
        // agent-hallucinated ids. KB chunks are club-wide so the
        // WHERE clause is just `id = $1`; no per-user scope predicate
        // like cite_fact carries.
        const row = await db
          .selectFrom("scout_kb_chunk")
          .innerJoin(
            "scout_kb_document",
            "scout_kb_document.id",
            "scout_kb_chunk.document_id",
          )
          .where("scout_kb_chunk.id", "=", chunkId)
          .select([
            "scout_kb_chunk.id",
            "scout_kb_chunk.document_id",
            "scout_kb_chunk.content",
            "scout_kb_chunk.page_start",
            "scout_kb_chunk.page_end",
            "scout_kb_document.title as document_title",
          ])
          .executeTakeFirst();

        if (!row) {
          return {
            cited: false as const,
            error:
              "KB chunk not found. Don't invent chunkIds — only cite ids returned by knowledge_search this turn.",
          };
        }

        const citationId = randomUUID();
        if (writer) {
          writer.write({
            type: "data-kb-citation",
            id: citationId,
            data: {
              chunkId: row.id,
              documentId: row.document_id,
              documentTitle: row.document_title,
              claim,
              content: row.content,
              pageStart: row.page_start,
              pageEnd: row.page_end,
            },
          });
        }

        return {
          cited: true as const,
          citationId,
          chunkId: row.id,
          documentId: row.document_id,
        };
      },
    }),
  };
}

function serialiseChunk(c: SearchResult) {
  return {
    id: c.id,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    content: c.content,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
    score: Number(c.score.toFixed(4)),
  };
}

export type KnowledgeTools = ReturnType<typeof createKnowledgeTools>;
