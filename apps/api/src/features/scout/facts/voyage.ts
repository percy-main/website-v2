import { z } from "zod";

/**
 * Thin REST client for Voyage AI's embedding + rerank endpoints. No SDK
 * dependency — Voyage's API is small, auth is a Bearer token, and adding
 * a third-party client just to hit two POST routes isn't worth the
 * supply-chain surface.
 *
 * Free tier as of 2026-05: 200M tokens shared across embedding + rerank
 * regardless of which model you pick. We default to voyage-4 (1024-dim,
 * matches the vector(1024) column in scout_fact) and rerank-2.5.
 */

const EMBED_URL = "https://api.voyageai.com/v1/embeddings";
const RERANK_URL = "https://api.voyageai.com/v1/rerank";

// Voyage rejects requests over their per-call payload caps long before
// they'd hurt our latency. Keep generous local limits as a safety net.
const MAX_BATCH = 128;

const embedResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number().int(),
    }),
  ),
  usage: z
    .object({
      total_tokens: z.number().int().optional(),
    })
    .optional(),
});

const rerankResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int(),
      relevance_score: z.number(),
    }),
  ),
  usage: z
    .object({
      total_tokens: z.number().int().optional(),
    })
    .optional(),
});

export interface VoyageClient {
  /**
   * Embed a single string. `inputType` lets Voyage pick the right
   * projection — "query" for retrieval queries, "document" for stored
   * facts. Mixing them up costs a few % recall.
   */
  embed: (text: string, inputType: "query" | "document") => Promise<number[]>;

  /** Embed many at once. Returns vectors in the same order as input. */
  embedBatch: (
    texts: string[],
    inputType: "query" | "document",
  ) => Promise<number[][]>;

  /**
   * Score `documents` against `query`, return them ordered by relevance.
   * Each result carries the original index into `documents` so the caller
   * can map back to its own row IDs.
   */
  rerank: (
    query: string,
    documents: string[],
    topK?: number,
  ) => Promise<Array<{ index: number; score: number }>>;
}

export interface VoyageConfig {
  apiKey: string;
  embedModel?: string;
  rerankModel?: string;
  // Allow tests / dev to swap the fetch impl. Defaults to globalThis.fetch.
  fetchImpl?: typeof fetch;
}

export function createVoyageClient(config: VoyageConfig): VoyageClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const embedModel = config.embedModel ?? "voyage-4";
  const rerankModel = config.rerankModel ?? "rerank-2.5";

  async function embedBatch(
    texts: string[],
    inputType: "query" | "document",
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > MAX_BATCH) {
      throw new Error(
        `Voyage embed batch size ${texts.length} exceeds local cap ${MAX_BATCH}`,
      );
    }

    const res = await fetchImpl(EMBED_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: embedModel,
        input: texts,
        input_type: inputType,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Voyage embed failed (HTTP ${res.status}): ${body.slice(0, 500)}`,
      );
    }

    const json = embedResponseSchema.parse(await res.json());
    // Voyage's response is keyed by index, not guaranteed-ordered. Sort
    // back into request order so callers can index by position.
    const ordered = new Array<number[]>(texts.length);
    for (const item of json.data) {
      ordered[item.index] = item.embedding;
    }
    return ordered;
  }

  return {
    embed: async (text, inputType) => {
      const [vec] = await embedBatch([text], inputType);
      return vec;
    },
    embedBatch,
    rerank: async (query, documents, topK) => {
      if (documents.length === 0) return [];
      const res = await fetchImpl(RERANK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: rerankModel,
          query,
          documents,
          top_k: topK,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Voyage rerank failed (HTTP ${res.status}): ${body.slice(0, 500)}`,
        );
      }

      const json = rerankResponseSchema.parse(await res.json());
      return json.data.map((d) => ({
        index: d.index,
        score: d.relevance_score,
      }));
    },
  };
}

/**
 * pgvector accepts/emits vectors as strings of the form "[0.1,0.2,...]".
 * Kysely-codegen types `embedding` as `string` for that reason; convert
 * via these helpers at the boundary.
 */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export function fromVectorLiteral(literal: string): number[] {
  // pgvector returns "[0.1,0.2]"; trim brackets and split.
  const trimmed = literal.startsWith("[") ? literal.slice(1, -1) : literal;
  return trimmed.split(",").map((s) => Number(s));
}
