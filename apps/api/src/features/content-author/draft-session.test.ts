import { describe, expect, it } from "vitest";
import { createDraftSession } from "./draft-session.ts";

const draft = () => [
  { id: "h1", type: "heading", content: "Report" },
  {
    id: "list1",
    type: "bulletListItem",
    content: "Top level",
    children: [{ id: "nested1", type: "bulletListItem", content: "Nested" }],
  },
  { id: "img1", type: "contentImage", props: { alt: "The pavilion" } },
  { id: "p1", type: "paragraph", content: "Closing thoughts." },
];

describe("draft session - append", () => {
  it("assigns a fresh id to every appended block and returns them", () => {
    const session = createDraftSession([]);
    const resolved = session.append([
      { type: "heading", props: { level: 2 }, content: "A fine win" },
      { type: "paragraph", content: "What a day." },
    ]);
    expect(resolved).toHaveLength(2);
    for (const block of resolved) {
      expect(block.id).toMatch(/[0-9a-f-]{36}/);
    }
    expect(new Set(resolved.map((b) => b.id)).size).toBe(2);
  });

  it("appended blocks become valid edit targets in the same session", () => {
    const session = createDraftSession([]);
    const [appended] = session.append([
      { type: "paragraph", content: "Draft me." },
    ]);
    const result = session.apply([
      {
        op: "update",
        blockId: appended.id,
        block: { type: "paragraph", content: "Rewritten." },
      },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("draft session - apply", () => {
  it("resolves inserts with fresh ids and reports them", () => {
    const session = createDraftSession(draft());
    const result = session.apply([
      {
        op: "insert",
        at: "after",
        refBlockId: "h1",
        blocks: [{ type: "paragraph", content: "New intro." }],
      },
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.insertedBlockIds).toHaveLength(1);
    const [op] = result.resolved;
    if (op.op !== "insert") throw new Error("expected insert");
    expect(op.blocks[0].id).toBe(result.insertedBlockIds[0]);
    expect(op.refBlockId).toBe("h1");
  });

  it("targets nested block ids (update and insert-relative)", () => {
    const session = createDraftSession(draft());
    const result = session.apply([
      {
        op: "update",
        blockId: "nested1",
        block: { type: "bulletListItem", content: "Nested, reworded" },
      },
      {
        op: "insert",
        at: "after",
        refBlockId: "nested1",
        blocks: [{ type: "bulletListItem", content: "A sibling" }],
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown block id with a recovery hint", () => {
    const session = createDraftSession(draft());
    const result = session.apply([{ op: "delete", blockIds: ["nope"] }]);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe(
      'Unknown block id "nope". Target ids from the draft listing in your instructions, or ids returned by earlier write_content/edit_content receipts this turn.',
    );
  });

  it("rejects before/after inserts without a refBlockId", () => {
    const session = createDraftSession(draft());
    const result = session.apply([
      {
        op: "insert",
        at: "before",
        blocks: [{ type: "paragraph", content: "x" }],
      },
    ]);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe('refBlockId is required when "at" is "before".');
  });

  it("rejects updates that target a non-writable (image) block", () => {
    const session = createDraftSession(draft());
    const result = session.apply([
      {
        op: "update",
        blockId: "img1",
        block: { type: "paragraph", content: "not a photo any more" },
      },
    ]);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain('"img1" is a contentImage block');
    expect(result.error).toContain("must not rewrite");
  });

  it("allows deleting an image block (session does not police intent)", () => {
    const session = createDraftSession(draft());
    expect(session.apply([{ op: "delete", blockIds: ["img1"] }]).ok).toBe(true);
  });

  it("delete removes descendants: a later op on the nested child fails", () => {
    const session = createDraftSession(draft());
    const result = session.apply([
      { op: "delete", blockIds: ["list1"] },
      {
        op: "update",
        blockId: "nested1",
        block: { type: "paragraph", content: "gone" },
      },
    ]);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain('Unknown block id "nested1"');
  });

  it("is all-or-nothing: a failing second op leaves the first unapplied", () => {
    const session = createDraftSession(draft());
    const failed = session.apply([
      { op: "delete", blockIds: ["p1"] },
      { op: "delete", blockIds: ["nope"] },
    ]);
    expect(failed.ok).toBe(false);
    // p1 must still exist - the failed batch must not have committed.
    expect(session.apply([{ op: "delete", blockIds: ["p1"] }]).ok).toBe(true);
  });

  it("a failing batch leaves no phantom inserted ids behind", () => {
    const session = createDraftSession(draft());
    const failed = session.apply([
      {
        op: "insert",
        at: "start",
        blocks: [{ type: "paragraph", content: "phantom" }],
      },
      { op: "delete", blockIds: ["nope"] },
    ]);
    expect(failed.ok).toBe(false);
    // Nothing committed, so there is no way to observe the phantom id; a
    // fresh valid batch still works against the original draft.
    const ok = session.apply([{ op: "delete", blockIds: ["h1"] }]);
    expect(ok.ok).toBe(true);
  });

  it("ops apply in order within a batch (insert then update the ref's neighbour)", () => {
    const session = createDraftSession(draft());
    const first = session.apply([
      {
        op: "insert",
        at: "start",
        blocks: [{ type: "heading", props: { level: 2 }, content: "Intro" }],
      },
    ]);
    if (!first.ok) throw new Error(first.error);
    const [newId] = first.insertedBlockIds;
    // The id from the receipt is targetable in a later call.
    const second = session.apply([
      {
        op: "update",
        blockId: newId,
        block: { type: "heading", props: { level: 3 }, content: "Intro v2" },
      },
    ]);
    expect(second.ok).toBe(true);
  });

  it("dedupes duplicate ids within one delete op", () => {
    const session = createDraftSession(draft());
    const result = session.apply([{ op: "delete", blockIds: ["p1", "p1"] }]);
    if (!result.ok) throw new Error(result.error);
    const [op] = result.resolved;
    if (op.op !== "delete") throw new Error("expected delete");
    expect(op.blockIds).toEqual(["p1"]);
  });
});
