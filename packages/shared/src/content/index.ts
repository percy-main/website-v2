import { z } from "zod";
import type { Resource } from "../auth/permissions.ts";

// ── Content kinds + statuses ────────────────────────────────────────────
//
// Live content editing (#479). One content_item table holds every kind;
// these constants are the single source of truth for the discriminator
// values (the DB check constraints mirror them).

export const CONTENT_KINDS = [
  "page",
  "news",
  "event",
  "game_report",
  "person",
] as const;

export const contentKindSchema = z.enum(CONTENT_KINDS);
export type ContentKind = z.infer<typeof contentKindSchema>;

export const CONTENT_STATUSES = ["draft", "published", "archived"] as const;

export const contentStatusSchema = z.enum(CONTENT_STATUSES);
export type ContentStatus = z.infer<typeof contentStatusSchema>;

/**
 * Which permission resource gates each kind. Pages are `content`, news and
 * events share `content_news`, game reports are `content_reports`, and
 * people are `content_people` (separate because person profiles carry
 * safeguarding-adjacent flags).
 */
export const CONTENT_KIND_RESOURCES = {
  page: "content",
  news: "content_news",
  event: "content_news",
  game_report: "content_reports",
  person: "content_people",
} as const satisfies Record<ContentKind, Resource>;

export type ContentResource = (typeof CONTENT_KIND_RESOURCES)[ContentKind];

// ── Body format: BlockNote document JSON ────────────────────────────────
//
// Per ADR 047 the canonical body is the BlockNote editor JSON block array
// stored as JSONB - not markdown. This schema validates the structural
// envelope every BlockNote block shares (id/type/props/content/children);
// the public renderer narrows per block type and ignores anything it does
// not recognise, so unknown types are safe to store. There is deliberately
// no raw-HTML block type anywhere in the pipeline.

export const blockPropValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export interface ContentBlock {
  id: string;
  type: string;
  props: Record<string, string | number | boolean>;
  content?: unknown;
  children: ContentBlock[];
}

export const contentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    props: z.record(z.string(), blockPropValueSchema),
    content: z.unknown().optional(),
    children: z.array(contentBlockSchema),
  }),
);

/** A content body: the top-level BlockNote block array. */
export const contentBodySchema = z.array(contentBlockSchema);
export type ContentBody = z.infer<typeof contentBodySchema>;

// ── Kind-specific metadata (replaces MDX frontmatter) ───────────────────
//
// Validated on every write by the content API. Only kinds with a schema
// here are editable through the API; later phases add their kinds.

export const gameReportMetadataSchema = z.object({
  playCricketId: z.string().min(1),
});
export type GameReportMetadata = z.infer<typeof gameReportMetadataSchema>;

export const CONTENT_METADATA_SCHEMAS: Partial<
  Record<ContentKind, z.ZodType<Record<string, unknown>>>
> = {
  game_report: gameReportMetadataSchema,
};

/** Kinds currently editable through the content API (grows per phase). */
export const ENABLED_CONTENT_KINDS = Object.keys(
  CONTENT_METADATA_SCHEMAS,
) as ContentKind[];

// ── Custom block types ──────────────────────────────────────────────────
//
// The directive vocabulary from the original epic plan, as BlockNote
// custom block type names. Single source of truth shared by the editor
// (which registers blocks under these names) and the public renderer
// (which maps them to the existing component map).

export const CUSTOM_BLOCK_TYPES = {
  person: "person",
  personGrid: "personGrid",
  gamePreview: "gamePreview",
  eventPreview: "eventPreview",
  // Editor-uploaded image. Replaces BlockNote's built-in image block in
  // the editor schema (whose URL-embed tab would bypass the consent +
  // processing pipeline). props.picture carries the JSON-stringified
  // PictureSource descriptor from the upload API so public pages render
  // the responsive ladder without any lookup.
  contentImage: "contentImage",
} as const;

// ── Slugs ───────────────────────────────────────────────────────────────
//
// Locked after first publish (no redirect handling exists anywhere), so
// they are validated strictly from the start.

export const contentSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase letters, numbers and hyphens",
  );
