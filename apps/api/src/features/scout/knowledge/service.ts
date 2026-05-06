import type { DB } from "@percy-main/db";
import { CompiledQuery, type Kysely, sql } from "kysely";
import { createHash } from "node:crypto";
import type { S3KnowledgeBaseStore } from "../../../lib/s3-knowledge-base.ts";
import { type FactTags, factTagsSchema } from "../facts/service.ts";
import { type VoyageClient, toVectorLiteral } from "../facts/voyage.ts";

/**
 * Scout knowledge base service. Three responsibilities:
 *   - CRUD over scout_kb_document (list / get / mint / commit / patch
 *     / delete / reingest).
 *   - Hybrid retrieval against scout_kb_chunk (vector ∪ FTS ∪ tags →
 *     Voyage rerank-2.5), used by the knowledge_search tool.
 *
 * All factories take their deps explicitly so tests can inject a
 * testcontainers DB + a mocked Voyage client without touching globals.
 */

// ── Shared types ──

export type DocumentKind = "pdf" | "image" | "text";

export const KB_STATUSES = [
  "awaiting-upload",
  "queued",
  "ingesting",
  "ready",
  "failed",
] as const;
export type DocumentStatus = (typeof KB_STATUSES)[number];

const ALLOWED_CONTENT_TYPES: Record<
  string,
  { kind: DocumentKind; ext: string }
> = {
  "application/pdf": { kind: "pdf", ext: "pdf" },
  "image/png": { kind: "image", ext: "png" },
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/gif": { kind: "image", ext: "gif" },
  "text/plain": { kind: "text", ext: "txt" },
  "text/markdown": { kind: "text", ext: "md" },
};

export interface DocumentRow {
  id: string;
  uploadedBy: string | null;
  title: string;
  description: string | null;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: DocumentStatus;
  errorMessage: string | null;
  pageCount: number | null;
  chunkCount: number;
  tags: FactTags;
  createdAt: Date;
  updatedAt: Date;
}

// ── Errors ──

export class KbDocumentNotFoundError extends Error {
  constructor() {
    super("KB document not found");
  }
}

export class KbDocumentInvalidStateError extends Error {
  constructor(public readonly state: DocumentStatus) {
    super(`KB document is in ${state} state`);
  }
}

export class KbUploadMissingError extends Error {
  constructor() {
    super("Pending KB upload not found in S3");
  }
}

export class KbUploadSizeMismatchError extends Error {
  constructor(
    public readonly declared: number,
    public readonly actual: number,
  ) {
    super(`Uploaded size ${actual} does not match declared ${declared}`);
  }
}

export class KbDuplicateContentError extends Error {
  constructor(public readonly existingDocumentId: string) {
    super(
      `KB already contains a document with the same content (id=${existingDocumentId})`,
    );
  }
}

export class KbUnsupportedContentTypeError extends Error {
  constructor(public readonly contentType: string) {
    super(`Unsupported KB content type: ${contentType}`);
  }
}

export class KbSizeTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly limit: number,
  ) {
    super(`Document of ${sizeBytes} bytes exceeds limit ${limit}`);
  }
}

// ── Deps ──

export interface KbDeps {
  db: Kysely<DB>;
  store: S3KnowledgeBaseStore;
  /** Optional — KB without Voyage means no embeds at ingest time and
   *  no semantic search at retrieval time. Routes / tools gate on
   *  this, so the service surface stays consistent. */
  voyage?: VoyageClient;
  maxDocumentBytes: number;
  uploadUrlExpirySeconds: number;
}

// ── List ──

export interface ListInput {
  /** Optional substring filter against title / filename. */
  search?: string;
  /** Optional tag filter (jsonb @>). */
  tags?: FactTags;
}

export function listDocuments(deps: KbDeps) {
  return async (input: ListInput): Promise<DocumentRow[]> => {
    let query = deps.db
      .selectFrom("scout_kb_document")
      .selectAll()
      .orderBy("created_at", "desc");

    if (input.search && input.search.trim()) {
      const term = `%${input.search.trim().toLowerCase()}%`;
      query = query.where((eb) =>
        eb.or([
          eb(eb.fn("lower", ["title"]), "like", term),
          eb(eb.fn("lower", ["filename"]), "like", term),
        ]),
      );
    }

    if (input.tags && Object.keys(input.tags).length > 0) {
      const tagsJson = JSON.stringify(input.tags);
      // Kysely doesn't ship a typed @> operator for jsonb. Drop to
      // raw SQL via the `sql` template; same pattern as scout_fact's
      // service layer.
      query = query.where(sql<boolean>`tags @> ${tagsJson}::jsonb`);
    }

    const rows = await query.execute();
    return rows.map(rowToDocument);
  };
}

// ── Get (with signed URL) ──

export function getDocument(deps: KbDeps) {
  return async (
    id: string,
  ): Promise<{ document: DocumentRow; signedUrl: string | null }> => {
    const row = await loadRow(deps, id);
    const signedUrl =
      row.status === "ready" && row.s3_key
        ? await deps.store.getSignedDocumentUrl(row.s3_key, row.content_type)
        : null;
    return { document: rowToDocument(row), signedUrl };
  };
}

// ── Mint ──

export interface MintInput {
  uploadedBy: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  title?: string;
  description?: string;
  tags?: FactTags;
}

export interface MintResult {
  id: string;
  kind: DocumentKind;
  uploadUrl: string;
  uploadUrlExpiresInSeconds: number;
  pendingKey: string;
  status: DocumentStatus;
}

export function mintDocument(deps: KbDeps) {
  return async (input: MintInput): Promise<MintResult> => {
    const ct = ALLOWED_CONTENT_TYPES[input.contentType];
    if (!ct) {
      throw new KbUnsupportedContentTypeError(input.contentType);
    }
    if (input.sizeBytes > deps.maxDocumentBytes) {
      throw new KbSizeTooLargeError(input.sizeBytes, deps.maxDocumentBytes);
    }

    const tags = input.tags ?? {};
    const title = (input.title ?? input.filename).slice(0, 255);

    // Insert first so the row id seeds the S3 pending key — keeps
    // upload-bucket and DB row tightly coupled, which simplifies
    // cleanup if commit never runs (24h S3 lifecycle handles the
    // bytes; the awaiting-upload row remains until an admin GCs it).
    const row = await deps.db
      .insertInto("scout_kb_document")
      .values({
        uploaded_by: input.uploadedBy,
        title,
        description: input.description ?? null,
        kind: ct.kind,
        filename: input.filename,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        tags: JSON.stringify(tags),
        status: "awaiting-upload" satisfies DocumentStatus,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const { uploadUrl, pendingKey } = await deps.store.getSignedUploadUrl(
      row.id,
      ct.ext,
      input.contentType,
      deps.uploadUrlExpirySeconds,
    );

    await deps.db
      .updateTable("scout_kb_document")
      .set({ pending_key: pendingKey, updated_at: new Date() })
      .where("id", "=", row.id)
      .execute();

    return {
      id: row.id,
      kind: ct.kind,
      uploadUrl,
      uploadUrlExpiresInSeconds: deps.uploadUrlExpirySeconds,
      pendingKey,
      status: "awaiting-upload",
    };
  };
}

// ── Commit ──
//
// Verifies the upload landed (HEAD), pulls bytes for hashing + dedup,
// copies to permanent bucket, transitions to status='queued'. Caller
// (route layer) then launches the worker. We deliberately do NOT
// launch from the service so launch failures don't get swallowed by
// the route's response wrapper.

export interface CommitResult {
  id: string;
  status: DocumentStatus;
  contentHash: string;
  s3Key: string;
}

export function commitDocument(deps: KbDeps) {
  return async (id: string): Promise<CommitResult> => {
    const row = await loadRow(deps, id);

    if (row.status === "queued" || row.status === "ingesting") {
      // Idempotent: already past commit. Surface what we have.
      if (!row.s3_key || !row.content_hash) {
        throw new KbDocumentInvalidStateError(row.status);
      }
      return {
        id: row.id,
        status: row.status,
        contentHash: row.content_hash,
        s3Key: row.s3_key,
      };
    }
    if (row.status !== "awaiting-upload" && row.status !== "failed") {
      throw new KbDocumentInvalidStateError(row.status as DocumentStatus);
    }
    if (!row.pending_key) {
      throw new KbDocumentInvalidStateError(row.status as DocumentStatus);
    }

    const ct = ALLOWED_CONTENT_TYPES[row.content_type];
    if (!ct) {
      throw new KbUnsupportedContentTypeError(row.content_type);
    }

    const head = await deps.store.headPending(row.pending_key);
    if (!head) {
      throw new KbUploadMissingError();
    }
    if (head.contentLength !== row.size_bytes) {
      throw new KbUploadSizeMismatchError(row.size_bytes, head.contentLength);
    }

    const bytes = await deps.store.getPending(row.pending_key);
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    // Hash dedup: another committed (= populated content_hash) doc
    // with the same bytes already exists.
    const existing = await deps.db
      .selectFrom("scout_kb_document")
      .where("content_hash", "=", contentHash)
      .where("id", "!=", id)
      .select(["id"])
      .executeTakeFirst();
    if (existing) {
      throw new KbDuplicateContentError(existing.id);
    }

    const permanentKey = await deps.store.copyToPermanent(
      row.pending_key,
      id,
      ct.ext,
      row.content_type,
    );

    await deps.db
      .updateTable("scout_kb_document")
      .set({
        status: "queued" satisfies DocumentStatus,
        content_hash: contentHash,
        s3_key: permanentKey,
        pending_key: null,
        error_message: null,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();

    // Best-effort cleanup of the uploads-bucket object. The 24h
    // lifecycle is the safety net.
    void deps.store.deletePending(row.pending_key).catch(() => undefined);

    return {
      id,
      status: "queued",
      contentHash,
      s3Key: permanentKey,
    };
  };
}

// ── Patch ──

export interface PatchInput {
  title?: string;
  description?: string | null;
  tags?: FactTags;
}

export function patchDocument(deps: KbDeps) {
  return async (id: string, input: PatchInput): Promise<DocumentRow> => {
    const row = await loadRow(deps, id);

    const updates: Partial<{
      title: string;
      description: string | null;
      tags: string;
      updated_at: Date;
    }> = {};
    if (typeof input.title === "string")
      updates.title = input.title.slice(0, 255);
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);

    if (Object.keys(updates).length === 0) {
      return rowToDocument(row);
    }

    updates.updated_at = new Date();

    const updated = await deps.db
      .updateTable("scout_kb_document")
      .set(updates)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return rowToDocument(updated);
  };
}

// ── Delete ──

export function deleteDocument(deps: KbDeps) {
  return async (id: string): Promise<void> => {
    const row = await loadRow(deps, id);

    // Cascade-deletes scout_kb_chunk via FK; sets
    // scout_fact.source_kb_chunk_id = NULL atomically.
    await deps.db
      .deleteFrom("scout_kb_document")
      .where("id", "=", id)
      .execute();

    // Best-effort S3 cleanup. Orphaned bytes are tolerated — Scout
    // is admin-only, low volume.
    if (row.s3_key) {
      void deps.store.deleteDocument(row.s3_key).catch(() => undefined);
    }
    if (row.pending_key) {
      void deps.store.deletePending(row.pending_key).catch(() => undefined);
    }
  };
}

// ── Reingest ──

export interface ReingestResult {
  id: string;
  status: DocumentStatus;
}

export function reingestDocument(deps: KbDeps) {
  return async (id: string): Promise<ReingestResult> => {
    const row = await loadRow(deps, id);

    // Only documents that have already been committed (have an s3_key)
    // can re-ingest. Otherwise the worker will hit "no s3_key at
    // ingest time" and fail.
    if (!row.s3_key) {
      throw new KbDocumentInvalidStateError(row.status as DocumentStatus);
    }

    await deps.db
      .updateTable("scout_kb_document")
      .set({
        status: "queued" satisfies DocumentStatus,
        error_message: null,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();

    return { id, status: "queued" };
  };
}

// ── Search ──
//
// Hybrid retrieval mirroring retrieveFacts: vector ∪ FTS ∪ tag
// candidates → Voyage rerank-2.5 → top K. Tag filter is constraining
// (applied to every source) so a `team:Mitford` filter scopes the
// whole query rather than just one stream.

const VECTOR_CANDIDATES = 30;
const KEYWORD_CANDIDATES = 30;
const DEFAULT_TOP_K = 6;

export interface SearchInput {
  query: string;
  tags?: FactTags;
  limit?: number;
}

export interface SearchResult {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  tags: FactTags;
  score: number;
}

export function searchChunks(deps: KbDeps) {
  return async (input: SearchInput): Promise<SearchResult[]> => {
    if (!deps.voyage) return [];
    const limit = input.limit ?? DEFAULT_TOP_K;
    const queryEmbedding = await deps.voyage.embed(input.query, "query");
    const vectorLiteral = toVectorLiteral(queryEmbedding);

    const hasTagFilter = !!input.tags && Object.keys(input.tags).length > 0;
    const tagPredicate = hasTagFilter ? "AND c.tags @> $3::jsonb" : "";
    const tagParams = hasTagFilter ? [JSON.stringify(input.tags)] : [];

    // Only chunks belonging to ready documents are eligible — a
    // document still ingesting may have partial chunks visible mid-
    // transaction in pathological cases.
    const baseSelect = `
      c.id, c.document_id, c.content, c.page_start, c.page_end,
      c.tags, d.title AS document_title
      FROM scout_kb_chunk c
      JOIN scout_kb_document d ON d.id = c.document_id
      WHERE d.status = 'ready'
    `;

    const vectorRows = await deps.db.executeQuery(
      CompiledQuery.raw(
        `SELECT ${baseSelect}
           ${tagPredicate}
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
        [vectorLiteral, VECTOR_CANDIDATES, ...tagParams],
      ),
    );

    const ftsRows = await deps.db.executeQuery(
      CompiledQuery.raw(
        `SELECT ${baseSelect}
           AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', $1)
           ${hasTagFilter ? "AND c.tags @> $3::jsonb" : ""}
         LIMIT $2`,
        [input.query, KEYWORD_CANDIDATES, ...tagParams],
      ),
    );

    let tagOnlyRows: { rows: unknown[] } = { rows: [] };
    if (hasTagFilter) {
      tagOnlyRows = await deps.db.executeQuery(
        CompiledQuery.raw(
          `SELECT ${baseSelect}
             AND c.tags @> $1::jsonb
           LIMIT $2`,
          [JSON.stringify(input.tags), KEYWORD_CANDIDATES],
        ),
      );
    }

    interface Row {
      id: string;
      document_id: string;
      document_title: string;
      content: string;
      page_start: number | null;
      page_end: number | null;
      tags: FactTags;
    }

    const byId = new Map<string, Row>();
    for (const row of [
      ...(vectorRows.rows as Row[]),
      ...(ftsRows.rows as Row[]),
      ...(tagOnlyRows.rows as Row[]),
    ]) {
      byId.set(row.id, row);
    }
    const candidates = [...byId.values()];
    if (candidates.length === 0) return [];

    const reranked = await deps.voyage.rerank(
      input.query,
      candidates.map((c) => c.content),
      limit,
    );

    return reranked.map((r) => {
      const row = candidates[r.index];
      return {
        id: row.id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        content: row.content,
        pageStart: row.page_start,
        pageEnd: row.page_end,
        tags: row.tags,
        score: r.score,
      };
    });
  };
}

// ── Internals ──

interface RawRow {
  id: string;
  uploaded_by: string | null;
  title: string;
  description: string | null;
  kind: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  pending_key: string | null;
  s3_key: string | null;
  content_hash: string | null;
  tags: unknown;
  status: string;
  error_message: string | null;
  page_count: number | null;
  chunk_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

async function loadRow(deps: KbDeps, id: string): Promise<RawRow> {
  const row = await deps.db
    .selectFrom("scout_kb_document")
    .where("id", "=", id)
    .selectAll()
    .executeTakeFirst();
  if (!row) throw new KbDocumentNotFoundError();
  return row as RawRow;
}

function rowToDocument(row: RawRow): DocumentRow {
  // Defensive parse: tags are jsonb, but if a hand-edit slips in
  // something other than `{}`-shaped data we fall back to {} rather
  // than crashing the list endpoint.
  const tagsParse = factTagsSchema.safeParse(row.tags ?? {});
  return {
    id: row.id,
    uploadedBy: row.uploaded_by,
    title: row.title,
    description: row.description,
    kind: row.kind as DocumentKind,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    status: row.status as DocumentStatus,
    errorMessage: row.error_message,
    pageCount: row.page_count,
    chunkCount: row.chunk_count,
    tags: tagsParse.success ? tagsParse.data : {},
    createdAt:
      row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at
        : new Date(row.updated_at),
  };
}
