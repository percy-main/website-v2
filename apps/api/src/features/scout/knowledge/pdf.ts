/**
 * PDF text extraction for the KB ingestion pipeline.
 *
 * Track 1's chat-attachment deriver already extracts PDF text via
 * Haiku (see attachments/derive.ts). We reuse the same approach here:
 * the model returns the document's transcribed text, the chunker
 * paragraph-packs it, and we embed the chunks. Trade-off: we lose
 * per-page page numbers on chunks, so cite_kb chips show document
 * title only (no "page 4–5" range). Adding pdfjs-dist would buy that
 * back at the cost of a heavyweight dependency that pulls in DOM
 * globals and a Promise.try assumption — not worth it for v1, and
 * the citation chip already shows enough for an admin to navigate
 * the original PDF via its signed URL.
 */

import type { Tracer } from "@opentelemetry/api";
import { generateText, type LanguageModel } from "ai";
import { buildPhoenixTelemetry } from "../telemetry.ts";

const KB_PDF_PROMPT = `You will be shown a PDF uploaded to a cricket-club knowledge base. Transcribe the readable text verbatim — preserve names, numbers, headings, lists, and tabular structure where you can. After the transcription, add a short factual summary (3–5 sentences) of what the document is and what it contains. Do not interpret or speculate beyond what is on the page.

Aim to keep the transcription faithful enough that downstream search will surface this document for any question whose answer is written on its pages.`;

export class PdfExtractError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PdfExtractError";
  }
}

export interface ExtractPdfInput {
  bytes: Buffer;
}

/**
 * Extract a PDF's text via Haiku. Returns a single text blob — the
 * chunker handles paragraph packing. Page-level granularity is not
 * available; chunks emitted from this path will carry NULL
 * page_start / page_end.
 *
 * No `maxOutputTokens` cap — Track 1's chat-derive prompt is bounded
 * because chips render in a chat bubble, but KB ingestion needs the
 * full transcription to land in the chunk store. The real ceiling on
 * how much we transcribe is set by SCOUT_KB_MAX_DOCUMENT_BYTES at
 * upload time; if a PDF fits under that cap we want all of it
 * indexed.
 */
export async function extractPdfText(
  model: LanguageModel,
  phoenixTracer: Tracer,
  input: ExtractPdfInput,
): Promise<string> {
  let result;
  try {
    result = await generateText({
      model,
      telemetry: buildPhoenixTelemetry(phoenixTracer, "scout.kb_extract_pdf"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: KB_PDF_PROMPT },
            {
              type: "file",
              data: input.bytes,
              mediaType: "application/pdf",
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw new PdfExtractError("Failed to extract PDF via Haiku", err);
  }

  const text = result.text.trim();
  if (!text) {
    throw new PdfExtractError("Haiku returned empty text for PDF");
  }
  return text;
}
