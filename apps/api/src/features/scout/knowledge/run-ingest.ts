import type { Tracer } from "@opentelemetry/api";
import type { DB } from "@percy-main/db";
import type { LanguageModel } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../../config.ts";
import type { S3KnowledgeBaseStore } from "../../../lib/s3-knowledge-base.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { type DocumentKind, IngestError, ingestDocument } from "./ingest.ts";

/**
 * Run the KB ingestion pipeline against a queued `scout_kb_document`
 * row. Mirrors `runReport`: the entry function for the standalone
 * worker process plus an in-process dev fallback.
 *
 * Atomic claim — ECS RunTask is at-least-once, so two workers can
 * pick up the same row simultaneously. The `WHERE status = 'queued'
 * RETURNING ...` pattern lets exactly one transition the row out of
 * 'queued'; the loser sees an empty result and exits cleanly.
 */

export interface RunIngestDeps {
  db: Kysely<DB>;
  voyage: VoyageClient;
  /** Anthropic-backed model used for image captioning + PDF text
   *  extraction. Optional — when null, ingestion fails for image and
   *  pdf kinds, but text/markdown documents still work (they need
   *  only Voyage embeddings). */
  anthropicModel: LanguageModel | null;
  scoutKnowledgeBase: S3KnowledgeBaseStore;
  config: Config;
  logger: FastifyBaseLogger;
  phoenixTracer: Tracer;
}

export class IngestNotFoundError extends Error {
  constructor(documentId: string) {
    super(`scout_kb_document ${documentId} not found`);
    this.name = "IngestNotFoundError";
  }
}

export async function runIngest(
  deps: RunIngestDeps,
  documentId: string,
): Promise<void> {
  const { db, logger, scoutKnowledgeBase, voyage, config } = deps;

  const claimed = await db
    .updateTable("scout_kb_document")
    .set({ status: "ingesting", updated_at: new Date() })
    .where("id", "=", documentId)
    .where("status", "=", "queued")
    .returning(["id", "kind", "content_type", "s3_key", "tags", "filename"])
    .executeTakeFirst();

  if (!claimed) {
    // Either the row doesn't exist (caller bug) or another worker
    // got there first / status moved past 'queued'. Either way,
    // exit cleanly — the row is the source of truth.
    const exists = await db
      .selectFrom("scout_kb_document")
      .where("id", "=", documentId)
      .select("status")
      .executeTakeFirst();
    if (!exists) {
      throw new IngestNotFoundError(documentId);
    }
    logger.info(
      { documentId, status: exists.status },
      "scout_kb_ingest_skipped_non_queued",
    );
    return;
  }

  if (!claimed.s3_key) {
    // Defensive: the commit endpoint always sets s3_key before
    // transitioning status='queued'. If we hit this branch the row
    // is corrupt — fail closed.
    await markFailed(db, documentId, "Document has no s3_key at ingest time");
    return;
  }

  try {
    const bytes = await scoutKnowledgeBase.getDocument(claimed.s3_key);
    const tags = (claimed.tags ?? {}) as Record<string, string | string[]>;

    // anthropicModel may be null when ANTHROPIC_API_KEY isn't set;
    // ingest.ts throws IngestError for image/pdf kinds in that case
    // and lets text-only docs through.
    const result = await ingestDocument(
      {
        db,
        voyage,
        anthropicModel: deps.anthropicModel,
        imageCaptionMaxTokens: config.SCOUT_ATTACHMENT_DERIVE_MAX_TOKENS,
        chunkTargetTokens: config.SCOUT_KB_CHUNK_TARGET_TOKENS,
        chunkOverlapTokens: config.SCOUT_KB_CHUNK_OVERLAP_TOKENS,
        embedBatchSize: config.SCOUT_KB_EMBED_BATCH_SIZE,
        phoenixTracer: deps.phoenixTracer,
      },
      {
        documentId,
        kind: claimed.kind as DocumentKind,
        contentType: claimed.content_type,
        bytes,
        tags,
      },
    );

    await db
      .updateTable("scout_kb_document")
      .set({
        status: "ready",
        chunk_count: result.chunkCount,
        page_count: result.pageCount,
        error_message: null,
        updated_at: new Date(),
      })
      .where("id", "=", documentId)
      .execute();

    logger.info(
      {
        documentId,
        filename: claimed.filename,
        chunkCount: result.chunkCount,
        pageCount: result.pageCount,
      },
      "scout_kb_ingest_done",
    );
  } catch (err) {
    const message =
      err instanceof IngestError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    logger.error(
      { err, documentId, filename: claimed.filename },
      "scout_kb_ingest_failed",
    );
    await markFailed(db, documentId, message);
    throw err;
  }
}

async function markFailed(db: Kysely<DB>, documentId: string, message: string) {
  await db
    .updateTable("scout_kb_document")
    .set({
      status: "failed",
      error_message: message.slice(0, 500),
      updated_at: new Date(),
    })
    .where("id", "=", documentId)
    .execute();
}
