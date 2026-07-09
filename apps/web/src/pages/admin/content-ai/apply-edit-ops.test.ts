import type { ResolvedEditOp } from "@percy-main/shared/content";
import { describe, expect, it, vi } from "vitest";
import {
  appendBlocks,
  applyEditOps,
  type EditorLike,
} from "./apply-edit-ops.ts";

/** Stub editor whose getBlock knows a fixed id set; records all calls. */
function makeEditor(ids: string[]) {
  const editor = {
    document: ids.map((id) => ({ id })),
    getBlock: vi.fn((id: string) => (ids.includes(id) ? { id } : undefined)),
    insertBlocks: vi.fn(),
    updateBlock: vi.fn(),
    removeBlocks: vi.fn(),
  } satisfies EditorLike;
  return editor;
}

describe("appendBlocks", () => {
  it("inserts after the last document block", () => {
    const editor = makeEditor(["a", "b"]);
    appendBlocks(editor, [{ id: "new1", type: "paragraph", content: "Hi" }]);
    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [{ id: "new1", type: "paragraph", content: "Hi" }],
      { id: "b" },
      "after",
    );
  });
});

describe("applyEditOps", () => {
  it("applies insert start/end against the current document edges", () => {
    const editor = makeEditor(["a", "b"]);
    const ops: ResolvedEditOp[] = [
      {
        op: "insert",
        at: "start",
        blocks: [{ id: "s1", type: "paragraph", content: "First" }],
      },
      {
        op: "insert",
        at: "end",
        blocks: [{ id: "e1", type: "paragraph", content: "Last" }],
      },
    ];
    const result = applyEditOps(editor, ops);
    expect(result.applied).toBe(true);
    expect(editor.insertBlocks).toHaveBeenNthCalledWith(
      1,
      [{ id: "s1", type: "paragraph", content: "First" }],
      { id: "a" },
      "before",
    );
    expect(editor.insertBlocks).toHaveBeenNthCalledWith(
      2,
      [{ id: "e1", type: "paragraph", content: "Last" }],
      { id: "b" },
      "after",
    );
  });

  it("applies before/after inserts via the reference id", () => {
    const editor = makeEditor(["a", "b"]);
    applyEditOps(editor, [
      {
        op: "insert",
        at: "after",
        refBlockId: "a",
        blocks: [{ id: "n1", type: "paragraph", content: "Mid" }],
      },
    ]);
    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [{ id: "n1", type: "paragraph", content: "Mid" }],
      "a",
      "after",
    );
  });

  it("updates and deletes existing blocks", () => {
    const editor = makeEditor(["a", "b", "c"]);
    const result = applyEditOps(editor, [
      {
        op: "update",
        blockId: "a",
        block: { type: "heading", props: { level: 2 }, content: "New" },
      },
      { op: "delete", blockIds: ["b", "c"] },
    ]);
    expect(result.applied).toBe(true);
    expect(editor.updateBlock).toHaveBeenCalledWith("a", {
      type: "heading",
      props: { level: 2 },
      content: "New",
    });
    expect(editor.removeBlocks).toHaveBeenCalledWith(["b", "c"]);
  });

  it("drops the WHOLE batch when any target id is stale (never partial)", () => {
    const editor = makeEditor(["a"]);
    const result = applyEditOps(editor, [
      {
        op: "insert",
        at: "before",
        refBlockId: "gone",
        blocks: [{ id: "n1", type: "paragraph", content: "replacement" }],
      },
      // Without all-or-nothing, this delete of a live block would still fire
      // even though its paired replacement insert was skipped.
      { op: "delete", blockIds: ["a"] },
    ]);
    expect(result.applied).toBe(false);
    if (result.applied) throw new Error("expected drop");
    expect(result.missingIds).toEqual(["gone"]);
    expect(editor.insertBlocks).not.toHaveBeenCalled();
    expect(editor.updateBlock).not.toHaveBeenCalled();
    expect(editor.removeBlocks).not.toHaveBeenCalled();
  });

  it("reports each missing id once across ops", () => {
    const editor = makeEditor([]);
    const result = applyEditOps(editor, [
      {
        op: "update",
        blockId: "gone",
        block: { type: "paragraph", content: "x" },
      },
      { op: "delete", blockIds: ["gone", "gone-too"] },
    ]);
    if (result.applied) throw new Error("expected drop");
    expect(result.missingIds).toEqual(["gone", "gone-too"]);
  });
});
