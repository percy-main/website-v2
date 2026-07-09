import { describe, expect, it } from "vitest";
import {
  AGENT_WRITABLE_BLOCK_TYPES,
  draftBlocksSchema,
  editOpsSchema,
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

describe("draftBlocksSchema - validation", () => {
  it("accepts nested children and table content", () => {
    const result = draftBlocksSchema.safeParse([
      {
        id: "a1",
        type: "bulletListItem",
        content: "Fixtures",
        children: [
          { id: "a2", type: "bulletListItem", content: "vs Newcastle City" },
        ],
      },
      {
        id: "b1",
        type: "table",
        content: { type: "tableContent", rows: [{ cells: ["a", "b"] }] },
      },
      {
        id: "c1",
        type: "paragraph",
        content: "See the fixtures page.",
        hasFormatting: true,
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts an unknown block type (projection mirrors the editor, not the catalog)", () => {
    const result = draftBlocksSchema.safeParse([
      { id: "x", type: "contentImage", props: { alt: "The pavilion" } },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects a block missing an id or type", () => {
    expect(
      draftBlocksSchema.safeParse([{ type: "paragraph", content: "no id" }])
        .success,
    ).toBe(false);
    expect(
      draftBlocksSchema.safeParse([{ id: "a", content: "no type" }]).success,
    ).toBe(false);
  });

  it("accepts an empty draft", () => {
    expect(draftBlocksSchema.safeParse([]).success).toBe(true);
  });
});

describe("editOpsSchema - validation", () => {
  it("accepts a mix of insert, update and delete ops", () => {
    const result = editOpsSchema.safeParse([
      {
        op: "insert",
        at: "after",
        refBlockId: "abc",
        blocks: [{ type: "paragraph", content: "New intro." }],
      },
      {
        op: "update",
        blockId: "def",
        block: { type: "heading", props: { level: 2 }, content: "Reworded" },
      },
      { op: "delete", blockIds: ["ghi"] },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts insert at start/end without a refBlockId (tool enforces before/after)", () => {
    const result = editOpsSchema.safeParse([
      {
        op: "insert",
        at: "start",
        blocks: [{ type: "paragraph", content: "Top." }],
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an update whose replacement block is invalid", () => {
    expect(
      editOpsSchema.safeParse([
        { op: "update", blockId: "x", block: { type: "marquee" } },
      ]).success,
    ).toBe(false);
    expect(
      editOpsSchema.safeParse([
        {
          op: "update",
          blockId: "x",
          block: { type: "contentImage", props: {} },
        },
      ]).success,
    ).toBe(false);
  });

  it("rejects a delete with no ids and an empty ops array", () => {
    expect(
      editOpsSchema.safeParse([{ op: "delete", blockIds: [] }]).success,
    ).toBe(false);
    expect(editOpsSchema.safeParse([]).success).toBe(false);
  });

  it("rejects an unknown op", () => {
    expect(
      editOpsSchema.safeParse([{ op: "move", blockId: "x" }]).success,
    ).toBe(false);
  });
});
