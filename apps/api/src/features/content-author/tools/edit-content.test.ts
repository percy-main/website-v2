import { type UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createDraftSession } from "../draft-session.ts";
import { createEditContentTool } from "./edit-content.ts";

const opts = {
  toolCallId: "test-call",
  messages: [],
  abortSignal: undefined,
} as unknown as Parameters<
  NonNullable<
    ReturnType<typeof createEditContentTool>["edit_content"]["execute"]
  >
>[1];

function makeWriter() {
  return {
    write: vi.fn(),
    merge: vi.fn(),
    onError: undefined,
  } as unknown as UIMessageStreamWriter & { write: ReturnType<typeof vi.fn> };
}

// Op-shape validation lives in editOpsSchema (tested in
// packages/shared/src/content/block-catalog.test.ts); id/position validation
// lives in the draft session (draft-session.test.ts). These tests cover the
// tool's streaming side effect + receipts.
describe("edit_content tool", () => {
  it("streams a single data-content-ops part with resolved ops and returns a receipt", async () => {
    const writer = makeWriter();
    const session = createDraftSession([
      { id: "p1", type: "paragraph", content: "Old text." },
    ]);
    const { edit_content } = createEditContentTool({ writer, session });
    const exec = edit_content.execute;
    if (!exec) throw new Error("no execute");

    const result = await exec(
      {
        ops: [
          {
            op: "update",
            blockId: "p1",
            block: { type: "paragraph", content: "New text." },
          },
          {
            op: "insert",
            at: "end",
            blocks: [{ type: "paragraph", content: "Appendix." }],
          },
        ],
      },
      opts,
    );

    expect(writer.write).toHaveBeenCalledTimes(1);
    const part = writer.write.mock.calls[0][0] as {
      type: string;
      id: string;
      data: { ops: { op: string; blocks?: { id?: string }[] }[] };
    };
    expect(part.type).toBe("data-content-ops");
    expect(part.id).toBeTruthy();
    expect(part.data.ops).toHaveLength(2);
    // The insert's blocks carry server-assigned ids for the client to honour.
    expect(part.data.ops[1].blocks?.[0].id).toBeTruthy();

    expect(result).toMatchObject({ applied: true, opCount: 2 });
    expect(
      (result as { insertedBlockIds: string[] }).insertedBlockIds,
    ).toHaveLength(1);
  });

  it("returns an { error } receipt and streams nothing when validation fails", async () => {
    const writer = makeWriter();
    const session = createDraftSession([]);
    const { edit_content } = createEditContentTool({ writer, session });
    const exec = edit_content.execute;
    if (!exec) throw new Error("no execute");

    const result = await exec(
      { ops: [{ op: "delete", blockIds: ["missing"] }] },
      opts,
    );

    expect(writer.write).not.toHaveBeenCalled();
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(
      'Unknown block id "missing"',
    );
  });
});
