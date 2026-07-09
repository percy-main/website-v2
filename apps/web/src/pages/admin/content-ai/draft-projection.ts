import { inlineToText } from "@/components/content-body.js";
import {
  CUSTOM_BLOCK_TYPES,
  type DraftBlock,
  type DraftBlocks,
  type TableContent,
} from "@percy-main/shared/content";

// Projects the live BlockNote document into the compact DraftBlocks shape the
// agent sees each turn (ids + types + plain-text content). Pure functions,
// duck-typed against the editor document so tests need no BlockNote runtime.

/** Structural slice of a BlockNote Block - all we read from the editor. */
export interface EditorDocumentBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: EditorDocumentBlock[];
}

// Schema caps (draftBlockSchema / draftBlocksSchema) - stay inside them so a
// pathological draft degrades (tail truncated from the agent's view) instead
// of failing the whole request.
const MAX_CONTENT_CHARS = 8_000;
const MAX_TOP_LEVEL_BLOCKS = 500;
const MAX_CHILDREN = 100;

/** True when flattening this inline node to text would lose marks or links. */
function nodeHasFormatting(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const typed = node as { type?: unknown; styles?: unknown };
  if (typed.type === "link") return true;
  if (typed.type !== "text") return false;
  const styles = typed.styles;
  if (typeof styles !== "object" || styles === null) return false;
  return Object.values(styles).some(
    (value) => value !== undefined && value !== false && value !== "default",
  );
}

function inlineHasFormatting(content: unknown): boolean {
  return Array.isArray(content) && content.some(nodeHasFormatting);
}

/** BlockNote 0.51 table cells are either bare InlineContent[] or
 *  { type: "tableCell", content } objects - flatten both to a string. */
function cellToText(cell: unknown): { text: string; hasFormatting: boolean } {
  const inline = Array.isArray(cell)
    ? cell
    : typeof cell === "object" &&
        cell !== null &&
        (cell as { type?: unknown }).type === "tableCell"
      ? (cell as { content?: unknown }).content
      : undefined;
  return {
    text: inlineToText(inline),
    hasFormatting: inlineHasFormatting(inline),
  };
}

function projectTableContent(
  content: unknown,
): { table: TableContent; hasFormatting: boolean } | undefined {
  if (
    typeof content !== "object" ||
    content === null ||
    (content as { type?: unknown }).type !== "tableContent"
  ) {
    return undefined;
  }
  const rawRows = (content as { rows?: unknown }).rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) return undefined;

  let hasFormatting = false;
  const rows = rawRows.map((row) => {
    const rawCells = (row as { cells?: unknown }).cells;
    const cells = (Array.isArray(rawCells) ? rawCells : []).map((cell) => {
      const projected = cellToText(cell);
      hasFormatting ||= projected.hasFormatting;
      return projected.text;
    });
    return { cells };
  });

  // Carry the widths through: if the agent echoes them back on a table
  // update, the layout survives the rewrite.
  const rawWidths = (content as { columnWidths?: unknown }).columnWidths;
  const columnWidths =
    Array.isArray(rawWidths) &&
    rawWidths.every((width) => typeof width === "number" || width === null)
      ? (rawWidths as Array<number | null>)
      : undefined;

  return {
    table: {
      type: "tableContent",
      rows,
      ...(columnWidths ? { columnWidths } : {}),
    },
    hasFormatting,
  };
}

// Default styling props carry no signal for the agent - drop them to keep
// the prompt compact.
const DEFAULT_PROP_VALUES: Record<string, unknown> = {
  textColor: "default",
  backgroundColor: "default",
  textAlignment: "left",
};

// Image-pipeline blocks carry huge JSON payloads (responsive picture sets)
// the agent must never see or echo back - project only their captions.
const IMAGE_BLOCK_PROP_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  [CUSTOM_BLOCK_TYPES.contentImage]: new Set(["alt", "caption"]),
  [CUSTOM_BLOCK_TYPES.photoGallery]: new Set(),
};

function projectProps(
  type: string,
  props: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!props) return undefined;
  const allowlist = IMAGE_BLOCK_PROP_ALLOWLIST[type] as
    | ReadonlySet<string>
    | undefined;
  const projected: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (allowlist && !allowlist.has(key)) continue;
    if (DEFAULT_PROP_VALUES[key] === value) continue;
    if (value === "" || value === undefined || value === null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      projected[key] =
        typeof value === "string" ? value.slice(0, MAX_CONTENT_CHARS) : value;
    }
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectBlock(block: EditorDocumentBlock): DraftBlock {
  const draft: DraftBlock = { id: block.id, type: block.type };

  const props = projectProps(block.type, block.props);
  if (props) draft.props = props;

  const table = projectTableContent(block.content);
  if (table) {
    draft.content = table.table;
    if (table.hasFormatting) draft.hasFormatting = true;
  } else if (Array.isArray(block.content)) {
    const text = inlineToText(block.content);
    if (text !== "") draft.content = text.slice(0, MAX_CONTENT_CHARS);
    if (inlineHasFormatting(block.content)) draft.hasFormatting = true;
  }

  const children = block.children ?? [];
  if (children.length > 0) {
    draft.children = children.slice(0, MAX_CHILDREN).map(projectBlock);
  }

  return draft;
}

/** Project the live editor document for the agent's editor context. */
export function projectDraftBlocks(
  document: readonly EditorDocumentBlock[],
): DraftBlocks {
  return document.slice(0, MAX_TOP_LEVEL_BLOCKS).map(projectBlock);
}
