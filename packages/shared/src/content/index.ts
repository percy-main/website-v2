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

// ── Paths (pages only) ──────────────────────────────────────────────────
//
// A page's materialised URL path: one or more "/" + slug segments, each
// segment shaped exactly like contentSlugSchema. Locked (with the slug
// and parent) once the page has ever been published.

export const contentPathSchema = z
  .string()
  .min(2)
  .max(1000)
  .regex(
    /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/,
    "Path must be one or more /slug segments (lowercase letters, numbers and hyphens)",
  );

/**
 * Top-level URL space a ROOT page may not occupy. Only the first path
 * segment routes, so child pages are unaffected.
 *
 * Two sources:
 *  - the SPA router's top-level literals (apps/web/src/router.tsx) -
 *    they are matched ahead of the content catch-all, so a root page at
 *    one of these could never be reached;
 *  - infra prefixes (API mount, upload/asset serving, the content API
 *    itself).
 *
 * Keep in lockstep with router.tsx when adding top-level routes.
 */
export const RESERVED_ROOT_SLUGS: ReadonlySet<string> = new Set([
  // SPA router top-level literals
  "news",
  "calendar",
  "person",
  "fantasy",
  "leaderboard",
  "game",
  "report-incident",
  "purchase",
  "payment",
  "nets",
  "availability",
  "tell-me-about",
  "auth",
  "members",
  "membership",
  "scout",
  "admin",
  "junior-manager",
  // Infra prefixes
  "api",
  "uploads",
  "assets",
  "content",
]);

// ── Kind-specific metadata (replaces MDX frontmatter) ───────────────────
//
// Validated on every write by the content API. Only kinds with a schema
// here are editable through the API; later phases add their kinds.

export const gameReportMetadataSchema = z.object({
  playCricketId: z.string().min(1),
});
export type GameReportMetadata = z.infer<typeof gameReportMetadataSchema>;

/**
 * Page metadata mirrors the static MDX frontmatter (apps/web
 * lib/content.ts) so a DB-backed page renders indistinguishably from its
 * static version: menuOrder/isMainMenu drive nav placement, hideTitle
 * suppresses the H1, ldjson is pasted structured data (omitted when
 * unset - never an empty string).
 */
export const pageMetadataSchema = z.object({
  menuOrder: z.number().int().min(0).max(999).default(99),
  isMainMenu: z.boolean().default(false),
  hideTitle: z.boolean().default(false),
  ldjson: z.record(z.string(), z.unknown()).optional(),
});
export type PageMetadata = z.infer<typeof pageMetadataSchema>;

/**
 * One news tag. Shared between stored metadata (newsMetadataSchema) and
 * the public list's ?tag filter (listNewsQuerySchema in the API's
 * content schemas): a stored tag must never exceed what the filter
 * accepts, or its filter link would 400.
 */
export const newsTagSchema = z.string().min(1).max(100);

export const newsMetadataSchema = z.object({
  tags: z.array(newsTagSchema),
  // References the static people corpus, which stays as MDX in the web
  // app until Phase 4 - so only the format is validated here. The admin
  // UI's people picker is what ties the slug to a real person.
  authorSlug: contentSlugSchema.optional(),
});
export type NewsMetadata = z.infer<typeof newsMetadataSchema>;

export const eventMetadataSchema = z.object({
  when: z.iso.datetime({ offset: true }),
  finish: z.iso.datetime({ offset: true }).optional(),
  // Inline venue embed, deliberately minimal: no county/country fields.
  location: z
    .object({
      name: z.string().min(1),
      street: z.string().min(1),
      city: z.string().min(1),
      postcode: z.string().min(1),
      lat: z.number().optional(),
      lon: z.number().optional(),
    })
    .optional(),
});
export type EventMetadata = z.infer<typeof eventMetadataSchema>;

export const CONTENT_METADATA_SCHEMAS: Partial<
  Record<ContentKind, z.ZodType<Record<string, unknown>>>
> = {
  page: pageMetadataSchema,
  news: newsMetadataSchema,
  event: eventMetadataSchema,
  game_report: gameReportMetadataSchema,
};

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
  leagueTable: "leagueTable",
  leaderboard: "leaderboard",
  recordsWall: "recordsWall",
  contactForm: "contactForm",
  cookieSettingsLink: "cookieSettingsLink",
  consentVersion: "consentVersion",
} as const;
