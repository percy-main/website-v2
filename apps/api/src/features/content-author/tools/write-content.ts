import {
  writeContentBodySchema,
  type WriteContentBody,
} from "@percy-main/shared/content";
import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DraftSession } from "../draft-session.ts";

export interface WriteContentToolDeps {
  // The route wraps streamText in a createUIMessageStream; that gives us a
  // writer the tool uses to emit a data-content-blocks part. The frontend
  // panel appends those blocks to the live BlockNote editor. Same pattern as
  // Scout's chart_render (scout/tools/chart.ts) - the tool's job is to stream
  // a data part; the client does the rendering (here, the appending).
  writer: UIMessageStreamWriter;
  // Shared draft model: appends are tracked (and given ids) here so the
  // agent can target the new blocks with edit_content later in the turn.
  session: DraftSession;
}

// Anthropic requires each tool's input_schema to be an object at the top
// level, so wrap the block array in { blocks: [...] }.
const writeContentInputSchema = z.object({
  blocks: writeContentBodySchema,
});

export function createWriteContentTool(deps: WriteContentToolDeps) {
  const { writer, session } = deps;

  return {
    write_content: tool({
      description: `Append finished content blocks to the END of the editor's current draft. Content only reaches the page through write_content and edit_content - your chat prose is not saved anywhere. This tool only APPENDS; to rewrite existing blocks, insert at a specific position, or delete blocks, use edit_content.

How to use it:
- Do your research FIRST (the pc_*, db_run_sql and weather tools), THEN write. Never invent scores, names, dates or stats - only write what the tools returned.
- Pass an array of blocks in document order. They are appended after whatever is already in the draft, so don't repeat content the draft already has.
- You may call write_content several times in one turn (e.g. a heading + intro, then a result block, then a summary). Each call appends.
- The receipt returns the id of every block you appended - use those ids to target follow-up edit_content calls.
- Use the block types and props exactly as described in the "Content blocks" section of your instructions. Text blocks (paragraph, heading, list items, quote) take a plain string in "content"; the cricket/club blocks are driven by "props" only and take no content.

Example:
{
  "blocks": [
    { "type": "heading", "props": { "level": 2 }, "content": "A fine win at the weekend" },
    { "type": "paragraph", "content": "Percy Main produced a superb all-round display..." },
    { "type": "gamePreview", "props": { "playCricketId": "123456" } }
  ]
}`,
      inputSchema: writeContentInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; this tool only streams a data part.
      execute: async ({ blocks }: { blocks: WriteContentBody }) => {
        // The session assigns each block an id so (a) the client inserts it
        // with a known id and (b) the model can edit it later this turn.
        const resolved = session.append(blocks);
        writer.write({
          type: "data-content-blocks",
          id: randomUUID(),
          data: { blocks: resolved },
        });
        // Short receipt the model sees; the blocks themselves are already
        // streaming to the client via the data part above.
        return {
          written: true,
          count: resolved.length,
          blockIds: resolved.map((block) => block.id),
        };
      },
    }),
  };
}

export type WriteContentTools = ReturnType<typeof createWriteContentTool>;
