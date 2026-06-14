import { describe, expect, it } from "vitest";
import {
  AGENT_WRITABLE_BLOCK_TYPES,
  getBlockCatalogEntry,
  renderBlockCatalogForPrompt,
  writeContentBodySchema,
} from "./block-catalog.ts";
import { CUSTOM_BLOCK_TYPES } from "./index.ts";

describe("block catalog - coverage", () => {
  it("has an entry for every custom block type (no block falls out of the agent's vocabulary)", () => {
    for (const type of Object.values(CUSTOM_BLOCK_TYPES)) {
      expect(
        getBlockCatalogEntry(type),
        `missing catalog entry for ${type}`,
      ).toBeDefined();
    }
  });

  it("includes the default text blocks", () => {
    for (const type of [
      "paragraph",
      "heading",
      "bulletListItem",
      "numberedListItem",
      "quote",
      "table",
    ]) {
      expect(getBlockCatalogEntry(type)).toBeDefined();
    }
  });

  it("marks contentImage as not agent-writable", () => {
    expect(getBlockCatalogEntry("contentImage")?.agentWritable).toBe(false);
    expect(AGENT_WRITABLE_BLOCK_TYPES).not.toContain("contentImage");
  });

  it("renders a prompt reference of writable blocks, excluding contentImage", () => {
    const md = renderBlockCatalogForPrompt();
    expect(md).toContain("paragraph");
    expect(md).toContain("gamePreview");
    expect(md).toContain("wagonWheel");
    expect(md).not.toContain("contentImage");
  });
});

describe("writeContentBodySchema - validation", () => {
  it("accepts valid prose plus custom blocks", () => {
    const result = writeContentBodySchema.safeParse([
      { type: "heading", props: { level: 2 }, content: "A fine win" },
      { type: "paragraph", content: "What a day at the ground." },
      { type: "gamePreview", props: { playCricketId: "123456" } },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown block type", () => {
    const result = writeContentBodySchema.safeParse([
      { type: "marquee", content: "hi" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects a custom block missing a required prop", () => {
    const result = writeContentBodySchema.safeParse([
      { type: "gamePreview", props: {} },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects text content on a none-content block", () => {
    const result = writeContentBodySchema.safeParse([
      { type: "leaderboard", content: "nope" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects a block the agent may not author (contentImage)", () => {
    const result = writeContentBodySchema.safeParse([
      { type: "contentImage", props: { src: "/uploads/x.jpg" } },
    ]);
    expect(result.success).toBe(false);
  });

  it("accepts a table block carrying a tableContent object", () => {
    const result = writeContentBodySchema.safeParse([
      {
        type: "table",
        content: { type: "tableContent", rows: [{ cells: ["a", "b"] }] },
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    expect(writeContentBodySchema.safeParse([]).success).toBe(false);
  });
});
