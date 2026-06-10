import type { Editor, PartialBlock } from "./schema";

const DIRECTIVE_RE = /^::person\{slug="([^"]+)"\}$/;

// One-time inbound migration only (ADR 047): the legacy MDX corpus arrives
// as markdown once, with directive lines mapped to person blocks. Editor
// JSON is canonical from then on - nothing derives markdown back out.
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
