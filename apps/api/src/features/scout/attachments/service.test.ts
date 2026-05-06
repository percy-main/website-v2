import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  appendBlockToLastUserMessage,
  formatAttachmentsBlock,
  type AttachmentSummary,
} from "./service.ts";

const makeAttachment = (
  overrides: Partial<AttachmentSummary> = {},
): AttachmentSummary => ({
  id: "00000000-0000-0000-0000-000000000001",
  kind: "image",
  filename: "team-sheet.png",
  sizeBytes: 1024,
  contentType: "image/png",
  processingState: "ready",
  derivedText: "A team sheet for Mitford CC",
  processingError: null,
  ...overrides,
});

describe("formatAttachmentsBlock", () => {
  it("returns empty for no attachments", () => {
    expect(formatAttachmentsBlock([])).toBe("");
  });

  it("renders one line per attachment in a <chat-attachments> wrapper", () => {
    const block = formatAttachmentsBlock([
      makeAttachment({ kind: "image", filename: "a.png", derivedText: "x" }),
      makeAttachment({ kind: "pdf", filename: "b.pdf", derivedText: "y" }),
    ]);
    expect(block.split("\n")).toEqual([
      "<chat-attachments>",
      "- [attachment:image] a.png — x",
      "- [attachment:pdf] b.pdf — y",
      "</chat-attachments>",
    ]);
  });

  it("falls back when derivedText is null", () => {
    const block = formatAttachmentsBlock([
      makeAttachment({ derivedText: null, filename: "x.png" }),
    ]);
    expect(block).toContain("[no derived text]");
  });
});

describe("appendBlockToLastUserMessage", () => {
  it("appends a text part to the last user message preserving image parts", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "ok" },
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          // Pretend the user already attached a raw image part — we must
          // NOT clobber it when injecting the chat-attachments block.
          {
            type: "image",
            image: Buffer.from("fake"),
            mediaType: "image/png",
          },
        ],
      },
    ];

    const out = appendBlockToLastUserMessage(
      messages,
      "<chat-attachments>x</chat-attachments>",
    );
    const last = out[out.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    const parts = last.content as Array<{ type: string }>;
    // 2 originals + 1 appended text
    expect(parts).toHaveLength(3);
    expect(parts[0].type).toBe("text");
    expect(parts[1].type).toBe("image");
    expect(parts[2].type).toBe("text");
  });

  it("noops when the last message is not a user message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ];
    const out = appendBlockToLastUserMessage(messages, "block");
    expect(out[out.length - 1]).toBe(messages[messages.length - 1]);
  });

  it("noops when block is empty", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "Hi" }];
    const out = appendBlockToLastUserMessage(messages, "");
    expect(out).toBe(messages);
  });
});
