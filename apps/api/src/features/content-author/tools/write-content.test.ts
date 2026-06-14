import { type UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";
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
  it("streams a single data-content-blocks part and returns a receipt", async () => {
    const writer = makeWriter();
    const { write_content } = createWriteContentTool({ writer });
    const exec = write_content.execute;
    if (!exec) throw new Error("no execute");

    const blocks = [
      { type: "heading", props: { level: 2 }, content: "A fine win" },
      { type: "paragraph", content: "What a day." },
    ];
    const result = await exec({ blocks }, opts);

    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "data-content-blocks",
        data: { blocks },
      }),
    );
    // The streamed part carries a stable id the modal dedupes inserts on.
    expect(writer.write.mock.calls[0][0]).toHaveProperty("id");
    expect(result).toMatchObject({ written: true, count: 2 });
  });
});
