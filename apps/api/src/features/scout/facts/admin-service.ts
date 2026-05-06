import type { DB } from "@percy-main/db";
import { CompiledQuery, type Kysely, sql, type SqlBool } from "kysely";
import type { z } from "zod";
import type {
  factAdminItemSchema,
  listFactsQuerySchema,
  updateFactBodySchema,
} from "../schemas.ts";
import { toVectorLiteral, type VoyageClient } from "./voyage.ts";

/**
 * Admin-side queries for the scout_fact corpus. Used by the
 * /scout/facts admin routes so admin/official users can review,
 * edit, and delete recorded facts before bad ones compound.
 *
 * Edits that change `content` re-embed via Voyage so the vector stays
 * in sync — without this, retrieval would silently match the old
 * embedding while the user sees a corrected fact, which is the worst
 * possible failure mode (looks fine, behaves wrong).
 */

type AdminItem = z.infer<typeof factAdminItemSchema>;
type ListQuery = z.infer<typeof listFactsQuerySchema>;
type UpdateBody = z.infer<typeof updateFactBodySchema>;

// Note: source_kb_chunk_id and the joined kb_document_* fields are
// pulled in via a manual join below; SELECT_COLS only carries the
// fact's own columns so they can be used unchanged in the simpler
// getFact / count paths.
const SELECT_COLS = [
  "id",
  "user_id",
  "scope",
  "content",
  "tags",
  "confidence",
  "permanence",
  "source_thread_id",
  "source_kb_chunk_id",
  "superseded_by",
  "created_at",
  "updated_at",
] as const;

interface Row {
  id: string;
  user_id: string;
  scope: string;
  content: string;
  tags: unknown;
  confidence: number;
  permanence: string | null;
  source_thread_id: string | null;
  source_kb_chunk_id: string | null;
  superseded_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  // Optional join columns — only populated by the list query path
  // (which joins to scout_kb_chunk + scout_kb_document so the admin
  // UI can show "From document" links without a second roundtrip).
  kb_document_id?: string | null;
  kb_document_title?: string | null;
}

function toItem(row: Row): AdminItem {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope as AdminItem["scope"],
    content: row.content,
    tags: row.tags as AdminItem["tags"],
    confidence: row.confidence,
    permanence: row.permanence as AdminItem["permanence"],
    sourceThreadId: row.source_thread_id,
    sourceKbChunkId: row.source_kb_chunk_id,
    sourceKbDocument:
      row.kb_document_id && row.kb_document_title
        ? { id: row.kb_document_id, title: row.kb_document_title }
        : null,
    supersededBy: row.superseded_by,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  };
}

export class FactNotFoundError extends Error {
  constructor() {
    super("Fact not found");
  }
}

export function listFacts(db: Kysely<DB>) {
  return async (
    params: ListQuery,
  ): Promise<{ facts: AdminItem[]; total: number }> => {
    let query = db
      .selectFrom("scout_fact")
      .leftJoin(
        "scout_kb_chunk",
        "scout_kb_chunk.id",
        "scout_fact.source_kb_chunk_id",
      )
      .leftJoin(
        "scout_kb_document",
        "scout_kb_document.id",
        "scout_kb_chunk.document_id",
      )
      .select([
        "scout_fact.id",
        "scout_fact.user_id",
        "scout_fact.scope",
        "scout_fact.content",
        "scout_fact.tags",
        "scout_fact.confidence",
        "scout_fact.permanence",
        "scout_fact.source_thread_id",
        "scout_fact.source_kb_chunk_id",
        "scout_fact.superseded_by",
        "scout_fact.created_at",
        "scout_fact.updated_at",
        "scout_kb_document.id as kb_document_id",
        "scout_kb_document.title as kb_document_title",
      ]);

    if (!params.includeSuperseded) {
      query = query.where("scout_fact.superseded_by", "is", null);
    }
    if (params.scope) {
      query = query.where("scout_fact.scope", "=", params.scope);
    }
    if (params.q) {
      // websearch_to_tsquery handles typed queries gracefully (quotes,
      // negation). Same operator used in retrieveFacts.
      query = query.where(
        sql<SqlBool>`to_tsvector('english', scout_fact.content) @@ websearch_to_tsquery('english', ${params.q})`,
      );
    }
    if (params.tag) {
      // Tag arg is "key:value" string. Split exactly once on the first
      // colon so values containing ':' (rare but possible) are preserved.
      const idx = params.tag.indexOf(":");
      if (idx > 0) {
        const key = params.tag.slice(0, idx);
        const value = params.tag.slice(idx + 1);
        query = query.where(
          sql<SqlBool>`scout_fact.tags @> ${JSON.stringify({ [key]: value })}::jsonb`,
        );
      }
    }

    const offset = (params.page - 1) * params.pageSize;
    const rows = (await query
      .orderBy("scout_fact.created_at", "desc")
      .limit(params.pageSize)
      .offset(offset)
      .execute()) as unknown as Row[];

    // Separate count query — paginated results lose the row count
    // otherwise, and the admin UI needs to render "N of total".
    const totalRow = await db
      .selectFrom("scout_fact")
      .select(sql<string>`COUNT(*)`.as("count"))
      .$if(!params.includeSuperseded, (q) =>
        q.where("superseded_by", "is", null),
      )
      .$if(params.scope !== undefined, (q) =>
        q.where("scope", "=", params.scope as string),
      )
      .executeTakeFirstOrThrow();

    return {
      facts: rows.map(toItem),
      total: Number(totalRow.count),
    };
  };
}

export function getFact(db: Kysely<DB>) {
  return async (factId: string): Promise<AdminItem> => {
    const row = (await db
      .selectFrom("scout_fact")
      .select([...SELECT_COLS])
      .where("id", "=", factId)
      .executeTakeFirst()) as unknown as Row | undefined;
    if (!row) throw new FactNotFoundError();
    return toItem(row);
  };
}

export function updateFact(db: Kysely<DB>, voyage: VoyageClient) {
  return async (factId: string, body: UpdateBody): Promise<AdminItem> => {
    const existing = (await db
      .selectFrom("scout_fact")
      .select(["id", "content"])
      .where("id", "=", factId)
      .executeTakeFirst()) as { id: string; content: string } | undefined;
    if (!existing) throw new FactNotFoundError();

    const contentChanged =
      body.content !== undefined && body.content !== existing.content;

    if (contentChanged && body.content) {
      // Re-embed content edits via raw SQL because Kysely's update
      // builder doesn't know the `vector` type; mixing the typed update
      // with a raw embedding expression in one statement is messier than
      // a single CompiledQuery. Same parameterisation pattern as the
      // initial insert in service.ts.
      //
      // For COALESCE on permanence we use a sentinel string ('__keep__')
      // because NULL is a meaningful value here ("clear permanence to
      // unknown") and can't be distinguished from "leave alone" via
      // COALESCE alone.
      const embedding = await voyage.embed(body.content, "document");
      const permanenceParam =
        body.permanence === undefined ? "__keep__" : body.permanence;
      await db.executeQuery(
        CompiledQuery.raw(
          `UPDATE scout_fact
           SET content = $1,
               embedding = $2::vector,
               tags = COALESCE($3::jsonb, tags),
               scope = COALESCE($4, scope),
               confidence = COALESCE($5, confidence),
               permanence = CASE WHEN $6 = '__keep__' THEN permanence ELSE NULLIF($6, '__null__') END,
               updated_at = NOW()
           WHERE id = $7`,
          [
            body.content,
            toVectorLiteral(embedding),
            body.tags === undefined ? null : JSON.stringify(body.tags),
            body.scope ?? null,
            body.confidence ?? null,
            permanenceParam ?? "__null__",
            factId,
          ],
        ),
      );
    } else {
      // Metadata-only edit — no need to call Voyage.
      await db
        .updateTable("scout_fact")
        .$if(body.tags !== undefined, (q) =>
          q.set({ tags: JSON.stringify(body.tags) }),
        )
        .$if(body.scope !== undefined, (q) =>
          q.set({ scope: body.scope as string }),
        )
        .$if(body.confidence !== undefined, (q) =>
          q.set({
            // $if guard above guarantees defined; cast is the
            // narrowest way to satisfy the column's number type.
            // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
            confidence: body.confidence as number,
          }),
        )
        .$if(body.permanence !== undefined, (q) =>
          // body.permanence may be null (clear back to unknown) — both
          // valid update values, distinct from `undefined` (leave alone).
          q.set({ permanence: body.permanence as string | null }),
        )
        .set({ updated_at: new Date() })
        .where("id", "=", factId)
        .execute();
    }

    return getFact(db)(factId);
  };
}

/**
 * Hard-delete (the admin's "this fact is wrong, get rid of it"
 * action). Different from supersession: we don't keep history because
 * the row was incorrect, not just outdated. Citations referencing the
 * deleted id will resolve to "fact not found" via cite_fact's existing
 * visibility check.
 */
export function deleteFact(db: Kysely<DB>) {
  return async (factId: string): Promise<void> => {
    const result = await db
      .deleteFrom("scout_fact")
      .where("id", "=", factId)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new FactNotFoundError();
  };
}
