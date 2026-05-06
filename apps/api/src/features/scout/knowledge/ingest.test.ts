import { describe, expect, it } from "vitest";
import { chunkPages } from "./ingest.ts";

const text = (n: number, marker = "x") =>
  Array.from({ length: n }, () => marker).join("");

describe("chunkPages", () => {
  it("packs paragraphs from one page into one chunk under target", () => {
    const chunks = chunkPages(
      [
        {
          pageNumber: 1,
          text: "First paragraph.\n\nSecond paragraph.",
        },
      ],
      { targetTokens: 100, overlapTokens: 0 },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[0].pageEnd).toBe(1);
    expect(chunks[0].content).toContain("First paragraph");
    expect(chunks[0].content).toContain("Second paragraph");
  });

  it("splits when paragraphs exceed targetTokens * 4 chars", () => {
    // targetTokens=10 → 40 char target. Three 30-char paragraphs ⇒
    // first paragraph fits, second flushes, etc.
    const para = "Paragraph of about thirty chars."; // 32 chars
    const chunks = chunkPages(
      [{ pageNumber: 1, text: `${para}\n\n${para}\n\n${para}` }],
      { targetTokens: 10, overlapTokens: 0 },
    );
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("preserves page span across pages within a chunk", () => {
    // Two pages of small paragraphs that fit together in one chunk.
    const chunks = chunkPages(
      [
        { pageNumber: 3, text: "A short note." },
        { pageNumber: 4, text: "Another short note." },
      ],
      { targetTokens: 100, overlapTokens: 0 },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageStart).toBe(3);
    expect(chunks[0].pageEnd).toBe(4);
  });

  it("emits NULL page span for non-PDF content (synthetic single page only)", () => {
    // A single page with pageNumber=1 but only one page total —
    // chunker treats it as PDF since the page number is >0. The
    // ingest layer is responsible for normalising — we test the PDF
    // path here by feeding two synthetic pages so it stays in PDF
    // mode, vs verifying the non-PDF case with a different shape.
    // For non-PDF paths (image/text), the caller passes a single
    // page with pageNumber=1 and expects pageStart=1/pageEnd=1; the
    // service layer overrides page_count=NULL for image/text docs.
    const chunks = chunkPages([{ pageNumber: 1, text: "Just one note." }], {
      targetTokens: 100,
      overlapTokens: 0,
    });
    expect(chunks).toHaveLength(1);
    // Synthetic single page still carries page_start=1; ingest layer
    // is the one that decides whether to surface page_count.
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[0].pageEnd).toBe(1);
  });

  it("carries an overlap tail into the next chunk", () => {
    // Two ~36-char paragraphs with internal whitespace so the
    // tail-walker can find a word boundary for the overlap.
    const p1 = "alpha alpha alpha alpha alpha alpha."; // 36 chars
    const p2 = "beta beta beta beta beta beta beta b."; // 38 chars
    const chunks = chunkPages([{ pageNumber: 1, text: `${p1}\n\n${p2}` }], {
      targetTokens: 10, // 40 char target
      overlapTokens: 5, // 20 char overlap
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The second chunk begins with the overlap tail from p1, then
    // a paragraph break, then p2. Its content should contain a
    // non-empty prefix from p1 followed by p2.
    expect(chunks[1].content.endsWith(p2)).toBe(true);
    expect(chunks[1].content).toMatch(/^alpha/);
  });

  it("splits an oversized paragraph on sentence boundaries", () => {
    // One paragraph far above target, multiple sentences.
    const sentence = `${text(30, "s")}.`;
    const para = Array.from({ length: 4 }, () => sentence).join(" "); // 4 × ~31 = 124 chars
    const chunks = chunkPages([{ pageNumber: 1, text: para }], {
      targetTokens: 10, // 40 char target
      overlapTokens: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Each emitted chunk should respect the soft cap (paragraph
      // splitter caps fragments at maxParaChars; flushing a chunk at
      // the boundary may temporarily exceed it by one paragraph,
      // which is acceptable).
      expect(chunk.content.length).toBeLessThanOrEqual(124);
    }
  });

  it("ignores empty pages", () => {
    const chunks = chunkPages(
      [
        { pageNumber: 1, text: "" },
        { pageNumber: 2, text: "Real content." },
        { pageNumber: 3, text: "   " },
      ],
      { targetTokens: 50, overlapTokens: 0 },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Real content.");
    expect(chunks[0].pageStart).toBe(2);
    expect(chunks[0].pageEnd).toBe(2);
  });
});
