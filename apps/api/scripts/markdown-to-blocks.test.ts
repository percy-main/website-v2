import { contentBodySchema } from "@percy-main/shared/content";
import { describe, expect, it } from "vitest";
import {
  blocksEqualIgnoringIds,
  markdownToBlocks,
} from "./markdown-to-blocks.ts";

describe("markdownToBlocks", () => {
  it("converts a representative legacy report", () => {
    const blocks = markdownToBlocks(
      [
        "#### Result",
        "",
        "Percy Main won by 6 wickets",
        "",
        "#### Highlights",
        "",
        "**First win for PMCC 2nd XI in 1001 days!**",
        "",
        "MW Munir 35\\* & 1-19 (economy 2.38)",
        "",
        "Full scorecard on [Play-Cricket](https://percymain.play-cricket.com).",
      ].join("\n"),
    );

    // Valid against the schema the API enforces on write
    expect(() => contentBodySchema.parse(blocks)).not.toThrow();

    expect(blocks[0]).toMatchObject({
      type: "heading",
      props: { level: 4 },
      content: [{ type: "text", text: "Result" }],
    });
    expect(blocks[1]).toMatchObject({ type: "paragraph" });

    // Bold survives as a style
    const highlight = blocks[3];
    expect(highlight?.content).toEqual([
      {
        type: "text",
        text: "First win for PMCC 2nd XI in 1001 days!",
        styles: { bold: true },
      },
    ]);

    // Escaped asterisk is unescaped to a literal
    const munir = blocks[4];
    expect(JSON.stringify(munir?.content)).toContain("35* & 1-19");

    // Links become inline link nodes
    const last = blocks[5];
    expect(JSON.stringify(last?.content)).toContain(
      '"href":"https://percymain.play-cricket.com"',
    );
  });

  it("converts lists with nesting", () => {
    const blocks = markdownToBlocks(
      ["- one", "- two", "  - nested", "1. first"].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "bulletListItem",
      "bulletListItem",
      "numberedListItem",
    ]);
    expect(blocks[1]?.children[0]).toMatchObject({ type: "bulletListItem" });
    expect(() => contentBodySchema.parse(blocks)).not.toThrow();
  });

  it("converts blockquotes, code and tables", () => {
    const blocks = markdownToBlocks(
      [
        "> quoted wisdom",
        "",
        "```",
        "raw scores",
        "```",
        "",
        "| Player | Runs |",
        "| --- | --- |",
        "| Slaven | 78 |",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["quote", "codeBlock", "table"]);
    const table = blocks[2];
    expect(table?.content).toMatchObject({
      type: "tableContent",
      rows: [{ cells: [[{ text: "Player" }], [{ text: "Runs" }]] }, {}],
    });
    expect(() => contentBodySchema.parse(blocks)).not.toThrow();
  });

  it("refuses constructs it does not understand", () => {
    expect(() => markdownToBlocks("![alt](image.png)")).toThrow(/Unsupported/);
  });

  it("compares blocks ignoring generated ids", () => {
    const a = markdownToBlocks("# Title\n\nBody");
    const b = markdownToBlocks("# Title\n\nBody");
    const c = markdownToBlocks("# Title\n\nDifferent body");
    expect(a[0]?.id).not.toBe(b[0]?.id);
    expect(blocksEqualIgnoringIds(a, b)).toBe(true);
    expect(blocksEqualIgnoringIds(a, c)).toBe(false);
  });

  it("converts the entire legacy corpus without errors", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const dir = path.resolve(import.meta.dirname, "../../web/content/games");
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".mdx"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      const source = await fs.readFile(path.join(dir, file), "utf8");
      const body = source.replace(/^---\n[\s\S]*?\n---\n?/, "");
      const blocks = markdownToBlocks(body);
      expect(blocks.length).toBeGreaterThan(0);
      expect(() => contentBodySchema.parse(blocks)).not.toThrow();
    }
  });
});
