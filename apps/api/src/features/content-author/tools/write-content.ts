import {
  writeContentBodySchema,
  type WriteContentBody,
} from "@percy-main/shared/content";
import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface WriteContentToolDeps {
  // The route wraps streamText in a createUIMessageStream; that gives us a
  // writer the tool uses to emit a data-content-blocks part. The frontend
  // modal appends those blocks to the live BlockNote editor. Same pattern as
  // Scout's chart_render (scout/tools/chart.ts) - the tool's job is to stream
  // a data part; the client does the rendering (here, the appending).
  writer: UIMessageStreamWriter;
}

// Anthropic requires each tool's input_schema to be an object at the top
// level, so wrap the block array in { blocks: [...] }.
const writeContentInputSchema = z.object({
  blocks: writeContentBodySchema,
});

export function createWriteContentTool(deps: WriteContentToolDeps) {
  const { writer } = deps;

  return {
    write_content: tool({
      description: `Append finished content blocks to the END of the editor's current draft. This is the ONLY way to put content into the page - your chat prose is not saved anywhere.

How to use it:
- Do your research FIRST (the pc_*, db_run_sql and weather tools), THEN write. Never invent scores, names, dates or stats - only write what the tools returned.
- Pass an array of blocks in document order. They are appended after whatever is already in the draft, so don't repeat content the draft already has.
- You may call write_content several times in one turn (e.g. a heading + intro, then a result block, then a summary). Each call appends.
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
        const id = randomUUID();
        writer.write({
          type: "data-content-blocks",
          id,
          data: { blocks },
        });
        // Short receipt the model sees; the blocks themselves are already
        // streaming to the client via the data part above.
        return { written: true, blockId: id, count: blocks.length };
      },
    }),
  };
}

export type WriteContentTools = ReturnType<typeof createWriteContentTool>;
