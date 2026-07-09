import { type UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createDraftSession } from "../draft-session.ts";
import { createWriteContentTool } from "./write-content.ts";

const opts = {
  toolCallId: "test-call",
  messages: [],
  abortSignal: undefined,
} as unknown as Parameters<
  NonNullable<
    ReturnType<typeof createWriteContentTool>["write_content"]["execute"]
  >
>[1];

function makeWriter() {
  return {
    write: vi.fn(),
    merge: vi.fn(),
    onError: undefined,
  } as unknown as UIMessageStreamWriter & { write: ReturnType<typeof vi.fn> };
}

// Validation lives in writeContentBodySchema (tested in
// packages/shared/src/content/block-catalog.test.ts) - the AI SDK validates
// inputSchema before execute() runs, so a direct execute() call here accepts
// anything. These tests cover the streaming side effect + receipt.
describe("write_content tool", () => {
  it("streams a single data-content-blocks part with id-bearing blocks and returns a receipt", async () => {
    const writer = makeWriter();
    const session = createDraftSession([]);
    const { write_content } = createWriteContentTool({ writer, session });
    const exec = write_content.execute;
    if (!exec) throw new Error("no execute");

    const blocks = [
      { type: "heading", props: { level: 2 }, content: "A fine win" },
      { type: "paragraph", content: "What a day." },
    ];
    const result = await exec({ blocks }, opts);

    expect(writer.write).toHaveBeenCalledTimes(1);
    const part = writer.write.mock.calls[0][0] as {
      type: string;
      id: string;
      data: { blocks: Array<{ id: string; type: string; content?: unknown }> };
    };
    expect(part.type).toBe("data-content-blocks");
    // The streamed part carries a stable id the panel dedupes inserts on.
    expect(part.id).toBeTruthy();
    // Blocks stream with server-assigned ids so the model can edit them
    // later in the turn and the client inserts them under those ids.
    expect(part.data.blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
    ]);
    for (const block of part.data.blocks) {
      expect(block.id).toMatch(/[0-9a-f-]{36}/);
    }

    expect(result).toMatchObject({ written: true, count: 2 });
    const { blockIds } = result as { blockIds: string[] };
    expect(blockIds).toEqual(part.data.blocks.map((b) => b.id));
  });

  it("registers appended blocks in the shared session (editable afterwards)", async () => {
    const writer = makeWriter();
    const session = createDraftSession([]);
    const { write_content } = createWriteContentTool({ writer, session });
    const exec = write_content.execute;
    if (!exec) throw new Error("no execute");

    const result = await exec(
      { blocks: [{ type: "paragraph", content: "Appended." }] },
      opts,
    );
    const { blockIds } = result as { blockIds: string[] };

    expect(
      session.apply([
        {
          op: "update",
          blockId: blockIds[0],
          block: { type: "paragraph", content: "Edited." },
        },
      ]).ok,
    ).toBe(true);
  });
});
