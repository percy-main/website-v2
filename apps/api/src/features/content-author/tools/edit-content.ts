import { editOpsSchema, type EditOps } from "@percy-main/shared/content";
import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DraftSession } from "../draft-session.ts";

export interface EditContentToolDeps {
  // Same streaming pattern as write_content: the tool's job is to emit a
  // data-content-ops part; the client applies the ops to the live editor.
  writer: UIMessageStreamWriter;
  // Shared with write_content so both tools see one consistent view of the
  // draft (ids of blocks appended earlier this turn are valid edit targets).
  session: DraftSession;
}

// Anthropic requires each tool's input_schema to be an object at the top
// level, so wrap the op array in { ops: [...] } (mirrors write_content).
const editContentInputSchema = z.object({
  ops: editOpsSchema,
});

export function createEditContentTool(deps: EditContentToolDeps) {
  const { writer, session } = deps;

  return {
    edit_content: tool({
      description: `Edit the draft in place: insert blocks at a position, rewrite a block, or delete blocks. write_content only appends to the end - use edit_content for everything else.

Pass an array of ops. They apply in order within the call:
- { "op": "insert", "at": "start" | "end" | "before" | "after", "refBlockId": "<id>", "blocks": [...] } - insert new blocks. refBlockId is required for "before"/"after" and must be an existing block id. Blocks take the same shapes as write_content.
- { "op": "update", "blockId": "<id>", "block": { "type": ..., "props": ..., "content": ... } } - rewrite that block. Provided fields replace the block's current ones; omitted fields are kept, so update with only type/props to restyle a block WITHOUT touching its text. Nested child blocks are always kept. Providing "content" writes plain text: any bold/italic/links previously inside that block are LOST - avoid rewriting the content of blocks marked [has formatting] unless the user asked for that. Rewriting a table's content resets cell styling; echo back its columnWidths to keep the layout.
- { "op": "delete", "blockIds": ["<id>", ...] } - remove those blocks (their nested children go too).

Target block ids from the draft listing in your instructions, or ids returned in write_content/edit_content receipts earlier this turn. You cannot reference a block inserted by this same call - its id arrives in this call's receipt, for use in later calls. Never rewrite image blocks (contentImage, photoGallery); you may delete one, but only when the user explicitly asked.

If the call returns { "error": ... } then NOTHING was applied (ops in a call succeed or fail together) - fix the op and retry.`,
      inputSchema: editContentInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; this tool only streams a data part.
      execute: async ({ ops }: { ops: EditOps }) => {
        const result = session.apply(ops);
        if (!result.ok) {
          // No part is streamed on failure, so the editor stays untouched.
          // The model sees the error receipt and can correct the op - same
          // { error } receipt pattern as the db tools.
          return { error: result.error };
        }
        writer.write({
          type: "data-content-ops",
          id: randomUUID(),
          data: { ops: result.resolved },
        });
        return {
          applied: true,
          opCount: result.resolved.length,
          insertedBlockIds: result.insertedBlockIds,
        };
      },
    }),
  };
}

export type EditContentTools = ReturnType<typeof createEditContentTool>;
