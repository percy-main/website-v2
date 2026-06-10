import type {
  List,
  Content as MdastContent,
  PhrasingContent,
  Root,
  Table,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// One-time inbound migration converter (#487): GFM markdown from the
// legacy MDX corpus -> the BlockNote-shaped block document the content
// API stores (ADR 047). After the migration, markdown ceases to be used
// anywhere - the editor round-trips JSON only - so this deliberately
// supports just the constructs the corpus (and plain prose generally)
// uses: headings, paragraphs, emphasis, links, lists, blockquotes,
// code blocks, tables and thematic breaks.

export interface MigrationBlock {
  id: string;
  type: string;
  props: Record<string, string | number | boolean>;
  content?: unknown;
  children: MigrationBlock[];
}

interface StyledTextNode {
  type: "text";
  text: string;
  styles: Record<string, boolean>;
}

interface LinkNode {
  type: "link";
  href: string;
  content: StyledTextNode[];
}

type InlineNode = StyledTextNode | LinkNode;

function styledText(
  text: string,
  styles: Record<string, boolean>,
): StyledTextNode {
  return { type: "text", text, styles: { ...styles } };
}

function flattenInline(
  nodes: PhrasingContent[],
  styles: Record<string, boolean> = {},
): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(styledText(node.value, styles));
        break;
      case "strong":
        out.push(...flattenInline(node.children, { ...styles, bold: true }));
        break;
      case "emphasis":
        out.push(...flattenInline(node.children, { ...styles, italic: true }));
        break;
      case "delete":
        out.push(...flattenInline(node.children, { ...styles, strike: true }));
        break;
      case "inlineCode":
        out.push(styledText(node.value, { ...styles, code: true }));
        break;
      case "break":
        out.push(styledText("\n", styles));
        break;
      case "link": {
        const inner = flattenInline(node.children, styles).filter(
          (n): n is StyledTextNode => n.type === "text",
        );
        out.push({ type: "link", href: node.url, content: inner });
        break;
      }
      default:
        throw new Error(
          `Unsupported inline markdown node '${node.type}' - migrate this report by hand`,
        );
    }
  }
  return out;
}

function block(
  type: string,
  props: Record<string, string | number | boolean>,
  content?: unknown,
  children: MigrationBlock[] = [],
): MigrationBlock {
  return { id: crypto.randomUUID(), type, props, content, children };
}

function listToBlocks(list: List): MigrationBlock[] {
  const itemType = list.ordered ? "numberedListItem" : "bulletListItem";
  const blocks: MigrationBlock[] = [];
  for (const item of list.children) {
    let inline: InlineNode[] = [];
    const children: MigrationBlock[] = [];
    for (const child of item.children) {
      if (child.type === "paragraph" && inline.length === 0) {
        inline = flattenInline(child.children);
      } else if (child.type === "list") {
        children.push(...listToBlocks(child));
      } else {
        throw new Error(
          `Unsupported list item child '${child.type}' - migrate this report by hand`,
        );
      }
    }
    blocks.push(block(itemType, {}, inline, children));
  }
  return blocks;
}

function tableToBlock(table: Table): MigrationBlock {
  const rows = table.children.map((row) => ({
    cells: row.children.map((cell) => flattenInline(cell.children)),
  }));
  return block("table", {}, { type: "tableContent", rows });
}

function nodeToBlocks(node: MdastContent): MigrationBlock[] {
  switch (node.type) {
    case "heading":
      return [
        block(
          "heading",
          { level: Math.min(node.depth, 6) },
          flattenInline(node.children),
        ),
      ];
    case "paragraph":
      return [block("paragraph", {}, flattenInline(node.children))];
    case "list":
      return listToBlocks(node);
    case "blockquote": {
      const inline: InlineNode[] = [];
      for (const child of node.children) {
        if (child.type !== "paragraph") {
          throw new Error(
            `Unsupported blockquote child '${child.type}' - migrate this report by hand`,
          );
        }
        if (inline.length > 0) inline.push(styledText("\n", {}));
        inline.push(...flattenInline(child.children));
      }
      return [block("quote", {}, inline)];
    }
    case "code":
      return [
        block("codeBlock", { language: node.lang ?? "" }, [
          styledText(node.value, {}),
        ]),
      ];
    case "table":
      return [tableToBlock(node)];
    case "thematicBreak":
      return [];
    default:
      throw new Error(
        `Unsupported markdown node '${node.type}' - migrate this report by hand`,
      );
  }
}

/**
 * Convert a GFM markdown document into the block array the content API
 * stores. Throws on any construct it does not understand: for a one-time
 * migration, refusing loudly beats silently dropping content.
 */
export function markdownToBlocks(markdown: string): MigrationBlock[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as Root;

  const blocks: MigrationBlock[] = [];
  for (const node of tree.children) {
    blocks.push(...nodeToBlocks(node));
  }
  return blocks;
}

/**
 * Structural equality ignoring block ids (fresh UUIDs every run would
 * otherwise defeat the upsert's change detection). Keys are sorted
 * before comparison because Postgres JSONB does not preserve object key
 * order.
 */
export function blocksEqualIgnoringIds(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "id") continue;
      out[key] = canonicalise((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
