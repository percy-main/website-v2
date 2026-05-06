/**
 * PDF text extraction for the KB ingestion pipeline. Uses pdfjs-dist's
 * Node-compatible entry to walk pages and pull their text content.
 *
 * We extract per page rather than as a single blob so chunks can carry
 * `page_start` / `page_end` metadata. That lets `cite_kb` quote chapter
 * + page in the agent UI rather than just "from doc Foo".
 *
 * pdfjs-dist 5.x assumes a browser environment — at minimum it expects
 * DOMMatrix, ImageData, and Path2D on the global. We polyfill them
 * from @napi-rs/canvas (already a transitive of @react-pdf/renderer)
 * before the pdfjs import so the bundle resolves at module load.
 * The polyfills are idempotent: if some other module installed them
 * first, we leave the existing values alone.
 */

import "./pdf-polyfills.ts";

import * as pdfjsLib from "pdfjs-dist";

export interface ExtractedPage {
  /** 1-based page number, matching pdfjs convention. */
  pageNumber: number;
  /** Page text, with line breaks between text items. Empty string when
   *  the page is image-only (scanned PDF — out of scope for v1). */
  text: string;
}

export class PdfExtractError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PdfExtractError";
  }
}

/**
 * Extract text from every page of a PDF buffer. Throws PdfExtractError
 * when the PDF is encrypted, unparseable, or exceeds `maxPages`.
 *
 * pdfjs is verbose at info level; the worker pipes stdout/stderr to
 * CloudWatch already so we don't suppress it explicitly.
 */
export async function extractPdfPages(
  bytes: Buffer,
  opts: { maxPages: number },
): Promise<ExtractedPage[]> {
  let doc: pdfjsLib.PDFDocumentProxy;
  try {
    // pdfjs's Node entry takes a Uint8Array — copy out of the Buffer
    // rather than aliasing, so pdfjs's internal slicing can't mutate
    // shared memory.
    const data = new Uint8Array(bytes);
    const loadingTask = pdfjsLib.getDocument({
      data,
      // Don't try to render fonts (we only need text content, not
      // pixel-perfect rendering) and don't fetch standard fonts via
      // the Fetch API — the worker shouldn't make outbound calls
      // during text extraction.
      disableFontFace: true,
      useWorkerFetch: false,
      // 0 = errors only. pdfjs is chatty at default verbosity.
      verbosity: 0,
    });
    doc = await loadingTask.promise;
  } catch (err) {
    throw new PdfExtractError("Failed to load PDF document", err);
  }

  if (doc.numPages > opts.maxPages) {
    await doc.destroy();
    throw new PdfExtractError(
      `PDF has ${doc.numPages} pages, exceeds limit of ${opts.maxPages}`,
    );
  }

  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      pages.push({ pageNumber, text });
      // pdfjs caches per-page resources internally; cleanup releases
      // them so a 200-page PDF doesn't keep the whole document in
      // memory. Worker is short-lived but we still want predictable
      // peak RSS.
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return pages;
}
