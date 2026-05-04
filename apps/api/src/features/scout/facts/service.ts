import type { DB } from "@percy-main/db";
import { CompiledQuery, type Kysely } from "kysely";
import { z } from "zod";
import {
  fromVectorLiteral,
  toVectorLiteral,
  type VoyageClient,
} from "./voyage.ts";

/**
 * Scout fact RAG service. Two responsibilities:
 *  - recordFact: embed → dedup → insert/supersede
 *  - retrieveFacts: hybrid (vector ∪ tags ∪ FTS) → Voyage rerank → top N
 *
 * Both factories take `(db, voyage)` so tests can inject a real Postgres
 * (testcontainers) and a mocked Voyage client without touching globals.
 */

export const factScopeSchema = z.enum(["user", "club"]);
export type FactScope = z.infer<typeof factScopeSchema>;

export const factTagsSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]),
);
export type FactTags = z.infer<typeof factTagsSchema>;

export type FactPermanence = "permanent" | "seasonal" | "ephemeral";

/**
 * Infer permanence from a fact's `topic` tag when the caller didn't set
 * it explicitly. Conservative: anything not in the table stays NULL so
 * the auto-retrieve "skip if known" rule won't suppress questions for
 * facts whose shelf-life we don't know.
 */
const PERMANENCE_BY_TOPIC: Readonly<Record<string, FactPermanence>> = {
  handedness: "permanent",
  "bowling-style": "permanent",
  position: "permanent",
  ground: "seasonal",
  scheduling: "seasonal",
  rules: "seasonal",
  kit: "seasonal",
  weather: "ephemeral",
  form: "ephemeral",
  injury: "ephemeral",
};

export function inferPermanence(tags: FactTags): FactPermanence | null {
  const raw = tags.topic;
  const topic = Array.isArray(raw) ? raw[0] : raw;
  if (typeof topic !== "string") return null;
  return PERMANENCE_BY_TOPIC[topic] ?? null;
}

// Cosine distance threshold below which a new fact is treated as a
// near-duplicate of an existing one (i.e. we supersede instead of
// inserting a fresh row). Empirically, voyage-4 cosine distance < 0.10
// is "essentially the same statement"; 0.10–0.20 is "related but
// distinct".
const SUPERSEDE_DISTANCE = 0.1;

const VECTOR_CANDIDATES = 30;
const KEYWORD_CANDIDATES = 30;
const DEFAULT_TOP_K = 8;

export interface RecordFactInput {
  userId: string;
  scope: FactScope;
  content: string;
  tags?: FactTags;
  confidence?: number;
  /**
   * How long this fact stays useful. When omitted we infer from
   * `tags.topic`; when no rule matches we leave it NULL so the agent
   * doesn't silently skip a re-confirmation question on a fact whose
   * decay rate we haven't classified.
   */
  permanence?: FactPermanence | null;
  sourceThreadId?: string;
  sourceMessageId?: string;
}

export interface RecordedFact {
  id: string;
  action: "inserted" | "superseded";
  /** id of the prior fact this one superseded, if any */
  supersededId?: string;
}

export interface RetrievedFact {
  id: string;
  content: string;
  tags: FactTags;
  scope: FactScope;
  confidence: number;
  permanence: FactPermanence | null;
  /** Voyage rerank score (higher = more relevant). */
  score: number;
  createdAt: Date;
}

export interface RetrieveFactsInput {
  userId: string;
  query: string;
  /** Optional explicit tag filter, e.g. {team:"Mitford CC"}. */
  tags?: FactTags;
  topK?: number;
}

export function recordFact(db: Kysely<DB>, voyage: VoyageClient) {
  return async (input: RecordFactInput): Promise<RecordedFact> => {
    const tags = input.tags ?? {};
    const confidence = input.confidence ?? 3;
    // Explicit override (including explicit null to clear) wins; otherwise
    // infer from tags.topic.
    const permanence =
      input.permanence === undefined ? inferPermanence(tags) : input.permanence;

    const embedding = await voyage.embed(input.content, "document");
    const vectorLiteral = toVectorLiteral(embedding);

    // Find an existing live fact authored by the same user that's near
    // enough in vector space to count as the same statement. Scope the
    // dedup to the author so two captains can independently record their
    // own takes without colliding.
    const nearestQuery = await db.executeQuery(
      CompiledQuery.raw(
        `SELECT id, embedding <=> $1::vector AS distance
         FROM scout_fact
         WHERE user_id = $2
           AND superseded_by IS NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 1`,
        [vectorLiteral, input.userId],
      ),
    );
    const nearest = nearestQuery.rows[0] as
      | { id: string; distance: number | string }
      | undefined;

    const distance = nearest ? Number(nearest.distance) : Infinity;

    if (nearest && distance < SUPERSEDE_DISTANCE) {
      // Insert the new fact and point the old one at it. Two-statement
      // tx so both the insert and the supersession-pointer land atomically.
      const inserted = await db.transaction().execute(async (tx) => {
        const newRow = await tx.executeQuery(
          CompiledQuery.raw(
            `INSERT INTO scout_fact
              (user_id, scope, content, tags, embedding, confidence,
               permanence, source_thread_id, source_message_id)
             VALUES ($1, $2, $3, $4::jsonb, $5::vector, $6, $7, $8, $9)
             RETURNING id`,
            [
              input.userId,
              input.scope,
              input.content,
              JSON.stringify(tags),
              vectorLiteral,
              confidence,
              permanence,
              input.sourceThreadId ?? null,
              input.sourceMessageId ?? null,
            ],
          ),
        );
        const newId = (newRow.rows[0] as { id: string }).id;
        await tx
          .updateTable("scout_fact")
          .set({ superseded_by: newId, updated_at: new Date() })
          .where("id", "=", nearest.id)
          .execute();
        return newId;
      });

      return {
        id: inserted,
        action: "superseded",
        supersededId: nearest.id,
      };
    }

    // No near-duplicate — fresh insert.
    const out = await db.executeQuery(
      CompiledQuery.raw(
        `INSERT INTO scout_fact
          (user_id, scope, content, tags, embedding, confidence,
           permanence, source_thread_id, source_message_id)
         VALUES ($1, $2, $3, $4::jsonb, $5::vector, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.userId,
          input.scope,
          input.content,
          JSON.stringify(tags),
          vectorLiteral,
          confidence,
          permanence,
          input.sourceThreadId ?? null,
          input.sourceMessageId ?? null,
        ],
      ),
    );
    const id = (out.rows[0] as { id: string }).id;
    return { id, action: "inserted" };
  };
}

export function retrieveFacts(db: Kysely<DB>, voyage: VoyageClient) {
  return async (input: RetrieveFactsInput): Promise<RetrievedFact[]> => {
    const topK = input.topK ?? DEFAULT_TOP_K;
    const queryEmbedding = await voyage.embed(input.query, "query");
    const vectorLiteral = toVectorLiteral(queryEmbedding);

    const hasTagFilter = !!input.tags && Object.keys(input.tags).length > 0;
    // Tag filter is constraining, not additive: when the caller passes
    // {team:"Mitford CC"} they mean "only Mitford rows", not "Mitford
    // rows AND whatever vector/FTS happens to surface". Apply the same
    // jsonb @> predicate to every candidate query, so all sources stay
    // tag-scoped.
    const tagPredicate = hasTagFilter ? `AND tags @> $4::jsonb` : "";
    const tagParams = hasTagFilter ? [JSON.stringify(input.tags)] : [];

    // ── Vector candidates ──
    // Cosine ANN over the HNSW index. Filter live rows + visible scope
    // (the row's author OR scope = club).
    const vectorRows = await db.executeQuery(
      CompiledQuery.raw(
        `SELECT id, content, tags, scope, confidence, permanence, created_at
         FROM scout_fact
         WHERE superseded_by IS NULL
           AND (user_id = $1 OR scope = 'club')
           ${tagPredicate}
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [input.userId, vectorLiteral, VECTOR_CANDIDATES, ...tagParams],
      ),
    );

    // ── Keyword / FTS candidates ──
    // websearch_to_tsquery handles natural-language queries gracefully
    // (quotes, OR, negation). Catches "Swalwell" / "Mitford CC" /
    // exact-name lookups that vector search can de-prioritise.
    const ftsRows = await db.executeQuery(
      CompiledQuery.raw(
        `SELECT id, content, tags, scope, confidence, permanence, created_at
         FROM scout_fact
         WHERE superseded_by IS NULL
           AND (user_id = $1 OR scope = 'club')
           AND to_tsvector('english', content) @@ websearch_to_tsquery('english', $2)
           ${tagPredicate}
         LIMIT $3`,
        [input.userId, input.query, KEYWORD_CANDIDATES, ...tagParams],
      ),
    );

    // ── Tag-only candidates ──
    // When the caller scopes by tag we also want rows that match the
    // tag but aren't surfaced by vector/FTS — e.g. "everything about
    // Mitford CC", regardless of phrasing.
    let tagRows: { rows: unknown[] } = { rows: [] };
    if (hasTagFilter) {
      tagRows = await db.executeQuery(
        CompiledQuery.raw(
          `SELECT id, content, tags, scope, confidence, permanence, created_at
           FROM scout_fact
           WHERE superseded_by IS NULL
             AND (user_id = $1 OR scope = 'club')
             AND tags @> $2::jsonb
           LIMIT $3`,
          [input.userId, JSON.stringify(input.tags), KEYWORD_CANDIDATES],
        ),
      );
    }

    interface Row {
      id: string;
      content: string;
      tags: FactTags;
      scope: FactScope;
      confidence: number;
      permanence: FactPermanence | null;
      created_at: Date | string;
    }

    // Merge + dedup by id.
    const byId = new Map<string, Row>();
    for (const row of [
      ...(vectorRows.rows as Row[]),
      ...(ftsRows.rows as Row[]),
      ...(tagRows.rows as Row[]),
    ]) {
      byId.set(row.id, row);
    }

    const candidates = [...byId.values()];
    if (candidates.length === 0) return [];

    // ── Rerank ──
    // Voyage rerank-2.5 cross-encodes (query, content) pairs and scores
    // each. Without this step embedding similarity confidently surfaces
    // antonyms ("hates spin" vs "loves spin") because their embeddings
    // are very close.
    const reranked = await voyage.rerank(
      input.query,
      candidates.map((c) => c.content),
      topK,
    );

    return reranked.map((r) => {
      const row = candidates[r.index];
      return {
        id: row.id,
        content: row.content,
        tags: row.tags,
        scope: row.scope,
        confidence: row.confidence,
        permanence: row.permanence,
        score: r.score,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at
            : new Date(row.created_at),
      };
    });
  };
}

/**
 * Convenience for routes / tests: format facts as the markdown block
 * Scout sees in-prompt. Each line carries the fact's id as a [fact:UUID]
 * marker so the model can hand it to cite_fact when grounding a claim,
 * plus the fact's permanence and age so the debrief flow can decide
 * whether a recorded fact is still fresh enough to skip re-asking.
 * Kept here so the wire format lives next to the thing producing it.
 *
 * `now` is injectable so tests get deterministic age strings.
 */
export function formatFactsBlock(
  facts: RetrievedFact[],
  now: Date = new Date(),
): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f) => {
    const tagPairs = Object.entries(f.tags)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
      .join(" ");
    const tagSuffix = tagPairs ? ` [${tagPairs}]` : "";
    const meta: string[] = [`confidence ${f.confidence}/5`];
    if (f.permanence) {
      meta.push(`${f.permanence} · ${formatAge(f.createdAt, now)} old`);
    }
    return `- [fact:${f.id}] ${f.content} (${meta.join(" · ")}${tagSuffix})`;
  });
  return `<known-facts>\n${lines.join("\n")}\n</known-facts>`;
}

function formatAge(createdAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - createdAt.getTime());
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "<1d";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  return `${years}y`;
}

// Exported solely for tests that want to inspect raw vectors written.
export const _internal = { fromVectorLiteral, toVectorLiteral };
