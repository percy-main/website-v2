import type { DB } from "@percy-main/db";
import type { LanguageModel } from "ai";
import { CompiledQuery, type Kysely } from "kysely";
import { toVectorLiteral, type VoyageClient } from "../facts/voyage.ts";
import { captionImage, ImageCaptionError } from "./image.ts";
import { type ExtractedPage, extractPdfPages, PdfExtractError } from "./pdf.ts";

/**
 * KB document ingestion: extract text, chunk, embed, write rows.
 *
 * Idempotent at the chunk level — every call deletes existing chunks
 * for the document before inserting new ones. That means re-ingesting
 * a document is safe (e.g. after a chunking-knob change), but any
 * `scout_fact.source_kb_chunk_id` references to the old chunk ids
 * cascade to NULL via the FK. We accept that trade-off; chunk-id
 * stability via content matching is more complexity than it's worth.
 */

export type DocumentKind = "pdf" | "image" | "text";

export interface IngestOptions {
  db: Kysely<DB>;
  voyage: VoyageClient;
  /** Anthropic Haiku used to caption KB images. Same model the chat
   *  attachments deriver runs on; KB just uses a longer prompt. */
  imageCaptionModel: LanguageModel;
  imageCaptionMaxTokens: number;
  maxPdfPages: number;
  chunkTargetTokens: number;
  chunkOverlapTokens: number;
  embedBatchSize: number;
}

export interface IngestInput {
  documentId: string;
  kind: DocumentKind;
  contentType: string;
  bytes: Buffer;
  /** Document-level tags inherited by every chunk. */
  tags: Record<string, string | string[]>;
}

export interface IngestResult {
  pageCount: number | null;
  chunkCount: number;
}

export class IngestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

/**
 * Run the ingestion pipeline end-to-end. Caller is responsible for
 * status transitions on `scout_kb_document` — this function only
 * touches `scout_kb_chunk` and returns counts.
 */
export async function ingestDocument(
  opts: IngestOptions,
  input: IngestInput,
): Promise<IngestResult> {
  const pages = await extractPages(opts, input);
  const chunks = chunkPages(pages, {
    targetTokens: opts.chunkTargetTokens,
    overlapTokens: opts.chunkOverlapTokens,
  });

  if (chunks.length === 0) {
    throw new IngestError(
      `Document produced no chunks (kind=${input.kind}); refusing to ingest empty payload`,
    );
  }

  const embeddings = await embedChunks(opts, chunks);

  await opts.db.transaction().execute(async (tx) => {
    // Wipe-and-replace so re-ingestion is idempotent. FK on
    // scout_fact.source_kb_chunk_id is ON DELETE SET NULL — facts that
    // referenced the old chunks lose their pointer (acceptable per
    // plan; documented in migration).
    await tx
      .deleteFrom("scout_kb_chunk")
      .where("document_id", "=", input.documentId)
      .execute();

    // Bulk insert via raw SQL because Kysely's insertInto can't bind a
    // pgvector literal without going through CompiledQuery. Same
    // pattern as scout_fact's recordFact — see facts/service.ts.
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vectorLiteral = toVectorLiteral(embeddings[i]);
      await tx.executeQuery(
        CompiledQuery.raw(
          `INSERT INTO scout_kb_chunk
            (document_id, chunk_index, page_start, page_end, content,
             tags, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector)`,
          [
            input.documentId,
            i,
            chunk.pageStart,
            chunk.pageEnd,
            chunk.content,
            JSON.stringify(input.tags),
            vectorLiteral,
          ],
        ),
      );
    }
  });

  return {
    pageCount: input.kind === "pdf" ? pages.length : null,
    chunkCount: chunks.length,
  };
}

interface PageLike extends ExtractedPage {}

async function extractPages(
  opts: IngestOptions,
  input: IngestInput,
): Promise<PageLike[]> {
  switch (input.kind) {
    case "pdf": {
      try {
        return await extractPdfPages(input.bytes, {
          maxPages: opts.maxPdfPages,
        });
      } catch (err) {
        if (err instanceof PdfExtractError)
          throw new IngestError(err.message, err);
        throw err;
      }
    }
    case "image": {
      try {
        const caption = await captionImage(
          opts.imageCaptionModel,
          opts.imageCaptionMaxTokens,
          { bytes: input.bytes, contentType: input.contentType },
        );
        // Single synthetic page so the chunker has a uniform input
        // shape across kinds. page_start / page_end stay NULL on
        // image chunks (handled in chunkPages).
        return [{ pageNumber: 1, text: caption }];
      } catch (err) {
        if (err instanceof ImageCaptionError) {
          throw new IngestError(err.message, err);
        }
        throw err;
      }
    }
    case "text": {
      const text = input.bytes.toString("utf8").trim();
      return [{ pageNumber: 1, text }];
    }
  }
}

export interface ChunkRecord {
  /** 1-based page range. NULL for non-PDF kinds. */
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
}

interface ChunkOptions {
  targetTokens: number;
  overlapTokens: number;
}

/**
 * Token-approximating chunker.
 *
 * We don't want to ship a tokenizer dep just to bucket text. The
 * heuristic: 1 token ≈ 4 characters of English (OpenAI's published
 * rule of thumb, close enough for retrieval). This is *not* exact
 * matching to whatever Voyage tokenizes to internally — Voyage caps
 * documents at 32K tokens, comfortably above a 600-token target with
 * 100 overlap, so the heuristic only needs to be in the right
 * ballpark.
 *
 * Strategy:
 *  - Split each page into paragraphs (blank-line delimited).
 *  - Greedy-pack paragraphs until the running char-count exceeds
 *    targetTokens * 4. Push a chunk and start a new one with a
 *    suffix from the previous chunk worth `overlapTokens * 4` chars.
 *  - For PDFs the page span is the union of pages whose paragraphs
 *    landed in the chunk — preserves locality without forcing
 *    unnatural splits.
 *  - Pages that are individually larger than the target chunk are
 *    further split on sentence boundaries.
 */
export function chunkPages(
  pages: PageLike[],
  opts: ChunkOptions,
): ChunkRecord[] {
  const targetChars = opts.targetTokens * 4;
  const overlapChars = opts.overlapTokens * 4;

  // Flatten paragraphs while remembering the page each came from.
  interface Paragraph {
    text: string;
    pageNumber: number | null;
  }
  const paragraphs: Paragraph[] = [];
  for (const page of pages) {
    if (!page.text) continue;
    const parts = splitParagraphs(page.text, targetChars);
    for (const part of parts) {
      paragraphs.push({
        text: part,
        // PDFs carry real page numbers (>=1). Non-PDF pages always
        // arrive as the synthetic pageNumber=1; we strip that down
        // to NULL when emitting chunks.
        pageNumber: page.pageNumber,
      });
    }
  }

  const isPdf = pages.some((p) => p.pageNumber !== null && p.pageNumber > 0);
  const chunks: ChunkRecord[] = [];

  let buf: string[] = [];
  let bufChars = 0;
  let bufPages: number[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const content = buf.join("\n\n").trim();
    if (!content) {
      buf = [];
      bufChars = 0;
      bufPages = [];
      return;
    }
    chunks.push({
      content,
      pageStart: isPdf && bufPages.length > 0 ? Math.min(...bufPages) : null,
      pageEnd: isPdf && bufPages.length > 0 ? Math.max(...bufPages) : null,
    });
    // Carry an overlap tail into the next chunk.
    if (overlapChars > 0) {
      const tail = takeTail(content, overlapChars);
      if (tail) {
        buf = [tail];
        bufChars = tail.length;
        bufPages = bufPages.length > 0 ? [bufPages[bufPages.length - 1]] : [];
        return;
      }
    }
    buf = [];
    bufChars = 0;
    bufPages = [];
  };

  for (const para of paragraphs) {
    const cost = para.text.length + (buf.length === 0 ? 0 : 2);
    if (bufChars + cost > targetChars && buf.length > 0) {
      flush();
    }
    buf.push(para.text);
    bufChars += cost;
    if (para.pageNumber !== null) bufPages.push(para.pageNumber);
  }
  flush();

  return chunks;
}

function splitParagraphs(pageText: string, maxParaChars: number): string[] {
  const raw = pageText
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const para of raw) {
    if (para.length <= maxParaChars) {
      out.push(para);
      continue;
    }
    // Oversized paragraph — split on sentence boundaries until each
    // fragment fits. Falls back to char-slice if a single "sentence"
    // is itself huge (e.g. a 10K-char list with no punctuation).
    const sentences = para
      .split(/(?<=[.!?])\s+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    let acc = "";
    for (const sentence of sentences) {
      if (sentence.length > maxParaChars) {
        if (acc) {
          out.push(acc);
          acc = "";
        }
        for (let i = 0; i < sentence.length; i += maxParaChars) {
          out.push(sentence.slice(i, i + maxParaChars));
        }
        continue;
      }
      const next = acc ? `${acc} ${sentence}` : sentence;
      if (next.length > maxParaChars) {
        if (acc) out.push(acc);
        acc = sentence;
      } else {
        acc = next;
      }
    }
    if (acc) out.push(acc);
  }
  return out;
}

function takeTail(content: string, charBudget: number): string {
  if (content.length <= charBudget) return content;
  // Walk backwards from the budget point until we hit whitespace, so
  // the overlap doesn't slice mid-word.
  let start = content.length - charBudget;
  while (start < content.length && !/\s/.test(content[start])) start++;
  return content.slice(start).trim();
}

async function embedChunks(
  opts: IngestOptions,
  chunks: ChunkRecord[],
): Promise<number[][]> {
  const result: number[][] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += opts.embedBatchSize) {
    const batch = chunks.slice(i, i + opts.embedBatchSize);
    const vectors = await opts.voyage.embedBatch(
      batch.map((c) => c.content),
      "document",
    );
    for (let j = 0; j < batch.length; j++) {
      result[i + j] = vectors[j];
    }
  }
  return result;
}
