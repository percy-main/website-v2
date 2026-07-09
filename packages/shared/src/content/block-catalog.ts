import { z } from "zod";
import { blockPropValueSchema, CUSTOM_BLOCK_TYPES } from "./block-types.ts";

// ── Block catalog ───────────────────────────────────────────────────────
//
// The single source of truth the AI content-author agent uses to know what
// blocks exist, what props each one takes, and how to author them. The
// BlockNote editor schema (apps/web content-editor.tsx) registers the React
// components; this catalog mirrors their prop shapes so the API can:
//   1. validate the blocks the agent emits (write_content tool), and
//   2. render a block reference into the agent's system prompt.
//
// A sync test (block-catalog.test.ts) asserts every CUSTOM_BLOCK_TYPES value
// has an entry here, so a newly added editor block can't silently fall out of
// the agent's vocabulary.

/**
 * How a block carries inline content:
 * - "text": prose blocks whose `content` is a plain string (BlockNote accepts
 *   a string and wraps it in a single styled text node).
 * - "table": `content` is a structured tableContent object.
 * - "none": custom blocks driven entirely by props; they carry no content.
 */
export type BlockContentKind = "text" | "table" | "none";

export interface BlockCatalogEntry {
  type: string;
  /** When the agent should reach for this block. */
  description: string;
  contentKind: BlockContentKind;
  /**
   * Whether the AI author agent may emit this block. False for contentImage:
   * images must go through the upload/consent/EXIF pipeline, which the agent
   * cannot drive - it has no image bytes to upload.
   */
  agentWritable: boolean;
  /** Mirrors the editor block's propSchema. Required props are the ones the
   *  block is useless without (and which force the agent to do its research). */
  propsSchema: z.ZodType<Record<string, string | number | boolean>>;
}

// Standard styling props every default BlockNote block accepts. Optional and
// stripped if unset - the agent never needs to set them, but allowing them
// keeps validation from rejecting a block that carries them.
const styleProps = {
  textColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  textAlignment: z.enum(["left", "center", "right", "justify"]).optional(),
};

const noProps = z.object({}).transform(() => ({}));

export const BLOCK_CATALOG: readonly BlockCatalogEntry[] = [
  // ── Default text blocks ──
  {
    type: "paragraph",
    description: "A normal paragraph of prose. Your main building block.",
    contentKind: "text",
    agentWritable: true,
    propsSchema: z.object({ ...styleProps }),
  },
  {
    type: "heading",
    description:
      "A section heading. Use level 2 and 3 to structure a report; level 1 is the page title - avoid it.",
    contentKind: "text",
    agentWritable: true,
    propsSchema: z.object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      ...styleProps,
    }),
  },
  {
    type: "bulletListItem",
    description:
      "One item of a bulleted list. Emit one block per item; consecutive items render as a single list.",
    contentKind: "text",
    agentWritable: true,
    propsSchema: z.object({ ...styleProps }),
  },
  {
    type: "numberedListItem",
    description:
      "One item of a numbered list. Emit one block per item; consecutive items render as a single ordered list.",
    contentKind: "text",
    agentWritable: true,
    propsSchema: z.object({ ...styleProps }),
  },
  {
    type: "checkListItem",
    description: "A checklist item with a tick box.",
    contentKind: "text",
    agentWritable: true,
    propsSchema: z.object({ checked: z.boolean().optional(), ...styleProps }),
  },
  {
    type: "quote",
    description:
      "A pull quote / blockquote. Great for a captain's or player's words, or to highlight a standout line.",
    contentKind: "text",
    agentWritable: true,
    propsSchema: z.object({ ...styleProps }),
  },
  {
    type: "codeBlock",
    description: "A preformatted code block. Rarely needed for club content.",
    contentKind: "text",
    agentWritable: true,
    propsSchema: z.object({ language: z.string().optional() }),
  },
  {
    type: "table",
    description:
      "A simple data table. Prefer the dedicated cricket blocks (leagueTable, leaderboard, recordsWall) for stats; use a table only for bespoke rows.",
    contentKind: "table",
    agentWritable: true,
    propsSchema: noProps,
  },

  // ── Custom club / cricket blocks (all content: none) ──
  {
    type: CUSTOM_BLOCK_TYPES.person,
    description:
      "A single person card (photo, name, role). `slug` is the person's content slug - find it in content_item (kind='person').",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({
      slug: z.string().min(1),
      role: z.string().optional(),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.personGrid,
    description:
      "A grid of person cards. Set `slugs` to a comma-separated list of person slugs (easy path); optionally set `entries` to a JSON string of [{slug, role?}] to label each.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({
      slugs: z.string().optional(),
      entries: z.string().optional(),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.gamePreview,
    description:
      "A Play-Cricket fixture/result card. `playCricketId` is the match id - for a match report it is the draft's metadata.playCricketId; otherwise find it via the pc_* tools.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({ playCricketId: z.string().min(1) }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.eventPreview,
    description:
      "A calendar event card. All three props are required (the public renderer hides the card otherwise): `eventId` is the event's content slug (content_item, kind='event'), `name` is the event title, `when` is its ISO date - read them together from the content_item row.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({
      eventId: z.string().min(1),
      name: z.string().min(1),
      when: z.string().min(1),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.contentImage,
    description:
      "An uploaded image. NOT author-writable - images must go through the editor's upload pipeline.",
    contentKind: "none",
    agentWritable: false,
    propsSchema: z.object({
      src: z.string().optional(),
      alt: z.string().optional(),
      caption: z.string().optional(),
      picture: z.string().optional(),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.photoGallery,
    description:
      "A photo gallery: one main photo with a thumbnail strip. NOT author-writable - photos must go through the editor's upload pipeline.",
    contentKind: "none",
    agentWritable: false,
    propsSchema: z.object({ images: z.string().optional() }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.leagueTable,
    description:
      "A live league standings table. `divisionId` is the Play-Cricket division id (find it via the pc_* tools); `name` is an optional heading.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({
      divisionId: z.string().min(1),
      name: z.string().optional(),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.leaderboard,
    description:
      "The club batting/bowling leaderboard for the current season. No props.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: noProps,
  },
  {
    type: CUSTOM_BLOCK_TYPES.recordsWall,
    description: "The club all-time batting/bowling records wall. No props.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: noProps,
  },
  {
    type: CUSTOM_BLOCK_TYPES.wagonWheel,
    description:
      "An interactive shot chart for one innings of a match. `matchId` (our games id) is required; optionally narrow to one `batterRvId` / `bowlerRvId` and `inningsNumber`. Source these from the ball-by-ball tables (match_ball, rv_player_mapping).",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({
      matchId: z.string().min(1),
      inningsNumber: z.string().optional(),
      batterRvId: z.string().optional(),
      bowlerRvId: z.string().optional(),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.wormChart,
    description:
      "A cumulative-runs worm chart for a match. `matchId` is required; `inningsNumber` highlights one innings (empty = first).",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({
      matchId: z.string().min(1),
      inningsNumber: z.string().optional(),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.contactForm,
    description:
      "An embedded contact form. Optional `title` and `description` shown above the fields.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
    }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.cookieSettingsLink,
    description:
      "A link that reopens the cookie-consent banner. `text` overrides the link label.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: z.object({ text: z.string().optional() }),
  },
  {
    type: CUSTOM_BLOCK_TYPES.consentVersion,
    description: "Renders the current consent policy version string. No props.",
    contentKind: "none",
    agentWritable: true,
    propsSchema: noProps,
  },
];

const CATALOG_BY_TYPE: Record<string, BlockCatalogEntry> = Object.fromEntries(
  BLOCK_CATALOG.map((entry) => [entry.type, entry]),
);

export function getBlockCatalogEntry(
  type: string,
): BlockCatalogEntry | undefined {
  return CATALOG_BY_TYPE[type];
}

export const AGENT_WRITABLE_BLOCK_TYPES: readonly string[] =
  BLOCK_CATALOG.filter((entry) => entry.agentWritable).map(
    (entry) => entry.type,
  );

// ── Agent-authored block schema ─────────────────────────────────────────
//
// The shape the write_content tool accepts. Deliberately loose at the
// envelope (type / props / content / children) with a superRefine that
// validates each block against its catalog entry, so adding a catalog entry
// is enough to extend the agent's vocabulary - no schema edit needed.

/** Structured content for a `table` block. Cells are plain strings; BlockNote
 *  wraps each in a text node. */
export const tableContentSchema = z.object({
  type: z.literal("tableContent"),
  columnWidths: z.array(z.number().nullable()).optional(),
  rows: z.array(z.object({ cells: z.array(z.string()) })).min(1),
});
export type TableContent = z.infer<typeof tableContentSchema>;

// Deliberately non-recursive: no `children`. A flat block list covers every
// content need here (headings, prose, lists as consecutive items, the custom
// cricket/club blocks), and avoids a self-referential JSON schema being sent
// to the LLM as the tool's input schema (DeepSeek tool-calling is happier
// with a flat shape). Nested blocks can be added later if a real need appears.
export const writeContentBlockSchema = z
  .object({
    type: z.string().min(1),
    props: z.record(z.string(), blockPropValueSchema).optional(),
    content: z.union([z.string(), tableContentSchema]).optional(),
  })
  .superRefine((block, ctx) => {
    const entry = CATALOG_BY_TYPE[block.type];
    if (!entry) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: `Unknown block type "${block.type}". Allowed types: ${AGENT_WRITABLE_BLOCK_TYPES.join(", ")}.`,
      });
      return;
    }
    if (!entry.agentWritable) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: `Block type "${block.type}" cannot be authored by the assistant.`,
      });
      return;
    }
    const propsResult = entry.propsSchema.safeParse(block.props ?? {});
    if (!propsResult.success) {
      for (const issue of propsResult.error.issues) {
        ctx.addIssue({
          code: "custom",
          path: ["props", ...issue.path],
          message: issue.message,
        });
      }
    }
    const hasContent =
      block.content !== undefined &&
      !(typeof block.content === "string" && block.content === "");
    if (entry.contentKind === "none" && hasContent) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: `Block type "${block.type}" takes no text content; drive it with props only.`,
      });
    }
    if (
      entry.contentKind === "text" &&
      block.content !== undefined &&
      typeof block.content !== "string"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: `Block type "${block.type}" expects a plain string for content.`,
      });
    }
    if (
      entry.contentKind === "table" &&
      (block.content === undefined || typeof block.content === "string")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: `Block type "${block.type}" expects a tableContent object for content.`,
      });
    }
  });

export type WriteContentBlock = z.infer<typeof writeContentBlockSchema>;

export const writeContentBodySchema = z.array(writeContentBlockSchema).min(1);
export type WriteContentBody = z.infer<typeof writeContentBodySchema>;

// ── Prompt rendering ────────────────────────────────────────────────────

function describeProps(entry: BlockCatalogEntry): string {
  // Surface the schema's own shape rather than re-describing it by hand, so
  // the prompt can't drift from validation. We unwrap the ZodObject to read
  // its keys and which are optional.
  const schema = entry.propsSchema;
  const shape =
    schema instanceof z.ZodObject
      ? (schema.shape as Record<string, z.ZodType>)
      : {};
  const keys = Object.keys(shape);
  if (keys.length === 0) return "(no props)";
  return keys
    .map((key) => {
      const optional = shape[key].safeParse(undefined).success;
      return optional ? key : `${key} (required)`;
    })
    .join(", ");
}

/** Markdown block reference injected into the content-author system prompt. */
export function renderBlockCatalogForPrompt(): string {
  const lines = BLOCK_CATALOG.filter((entry) => entry.agentWritable).map(
    (entry) => {
      const contentNote =
        entry.contentKind === "text"
          ? " [content: plain string]"
          : entry.contentKind === "table"
            ? " [content: tableContent object]"
            : "";
      return `- \`${entry.type}\`${contentNote} - ${entry.description} Props: ${describeProps(entry)}.`;
    },
  );
  return lines.join("\n");
}

// ── Draft projection (editor -> agent) ──────────────────────────────────
//
// A compact read-only projection of the live BlockNote document, sent by the
// editor with every chat turn so the agent can see and target existing
// content. Inline content is flattened to a plain string client-side; blocks
// whose flattening dropped marks (bold/italic/links) are tagged hasFormatting
// so the agent knows a rewrite would lose them.

export interface DraftBlock {
  id: string;
  type: string;
  /** Plain-text projection of the block's inline content (or tableContent). */
  content?: string | TableContent;
  props?: Record<string, string | number | boolean>;
  /** True when flattening dropped inline marks (bold/italic/links). */
  hasFormatting?: boolean;
  children?: DraftBlock[];
}

export const draftBlockSchema: z.ZodType<DraftBlock> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    content: z.union([z.string().max(8_000), tableContentSchema]).optional(),
    props: z.record(z.string(), blockPropValueSchema).optional(),
    hasFormatting: z.boolean().optional(),
    children: z.array(draftBlockSchema).max(100).optional(),
  }),
);

export const draftBlocksSchema = z.array(draftBlockSchema).max(500);
export type DraftBlocks = z.infer<typeof draftBlocksSchema>;

// ── Edit operations (agent -> editor) ───────────────────────────────────
//
// The edit_content tool's vocabulary. Insert positions are a flat enum plus
// an optional refBlockId rather than a nested union so the tool's JSON schema
// stays simple for the LLM (same reasoning as writeContentBlockSchema being
// non-recursive). "refBlockId is required for before/after" is enforced by
// the tool at run time, not here, so the model gets a friendly correctable
// error receipt instead of an opaque schema failure.

export const insertPositionSchema = z.enum(["start", "end", "before", "after"]);
export type InsertPosition = z.infer<typeof insertPositionSchema>;

export const editInsertOpSchema = z.object({
  op: z.literal("insert"),
  at: insertPositionSchema,
  refBlockId: z.string().min(1).optional(),
  blocks: writeContentBodySchema,
});

export const editUpdateOpSchema = z.object({
  op: z.literal("update"),
  blockId: z.string().min(1),
  // writeContentBlockSchema also rejects non-agent-writable replacement
  // blocks (e.g. contentImage) via its catalog superRefine.
  block: writeContentBlockSchema,
});

export const editDeleteOpSchema = z.object({
  op: z.literal("delete"),
  blockIds: z.array(z.string().min(1)).min(1),
});

export const editOpSchema = z.discriminatedUnion("op", [
  editInsertOpSchema,
  editUpdateOpSchema,
  editDeleteOpSchema,
]);
export type EditOp = z.infer<typeof editOpSchema>;

export const editOpsSchema = z.array(editOpSchema).min(1).max(20);
export type EditOps = z.infer<typeof editOpsSchema>;

// Server-resolved shapes streamed to the client as a data-content-ops part.
// Inserted blocks get their ids assigned server-side (by the draft session)
// so the model can reference them in later tool calls; the client honours
// them via PartialBlock.id. Type-only: the client trusts the stream, same as
// the data-content-blocks parts.
export type ResolvedBlock = WriteContentBlock & { id: string };
export type ResolvedEditOp =
  | {
      op: "insert";
      at: InsertPosition;
      refBlockId?: string;
      blocks: ResolvedBlock[];
    }
  | { op: "update"; blockId: string; block: WriteContentBlock }
  | { op: "delete"; blockIds: string[] };
