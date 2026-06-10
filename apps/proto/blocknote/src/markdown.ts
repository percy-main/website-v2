import type { Block, Editor, PartialBlock } from "./schema";

const DIRECTIVE_RE = /^::person\{slug="([^"]+)"\}$/;

// BlockNote's markdown exporter has no hook for custom blocks (custom blocks
// fall back to their HTML rendering, not a markdown form), so the directive
// mapping lives out here: person blocks are swapped for their shortcode text
// and the surrounding runs of standard blocks go through blocksToMarkdownLossy.
// Runs are kept together so ordered-list numbering survives.
export async function toMarkdown(
  editor: Editor,
  blocks: Block[],
): Promise<string> {
  const chunks: (Block[] | string)[] = [];
  for (const block of blocks) {
    if (block.type === "person") {
      chunks.push(`::person{slug="${block.props.slug}"}`);
    } else {
      const last = chunks[chunks.length - 1];
      if (Array.isArray(last)) {
        last.push(block);
      } else {
        chunks.push([block]);
      }
    }
  }
  const parts = await Promise.all(
    chunks.map(async (chunk) =>
      typeof chunk === "string"
        ? chunk
        : (await editor.blocksToMarkdownLossy(chunk)).trim(),
    ),
  );
  return parts.join("\n\n") + "\n";
}

// Inverse mapping: markdown parses with the directive line as a plain text
// paragraph, which is then swapped for a person block.
export async function markdownToBlocks(
  editor: Editor,
  markdown: string,
): Promise<PartialBlock[]> {
  const blocks = await editor.tryParseMarkdownToBlocks(markdown);
  return blocks.map((block): PartialBlock => {
    if (
      block.type === "paragraph" &&
      Array.isArray(block.content) &&
      block.content.length === 1
    ) {
      const inline = block.content[0];
      if (inline.type === "text") {
        const match = DIRECTIVE_RE.exec(inline.text.trim());
        if (match) {
          return { type: "person", props: { slug: match[1] } };
        }
      }
    }
    return block;
  });
}
