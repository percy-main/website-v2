import { z } from "zod";
import type { Resource } from "../auth/permissions.ts";
import { blockPropValueSchema } from "./block-types.ts";
import { rrulestr } from "./rrule-compat.ts";

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
 *  - the SPA router's top-level literals (apps/web/src/routes.tsx) -
 *    they are matched ahead of the content catch-all, so a root page at
 *    one of these could never be reached;
 *  - infra prefixes (API mount, upload/asset serving, the content API
 *    itself).
 *
 * Keep in lockstep with routes.tsx when adding top-level routes.
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

/**
 * The public URL for a published content item - the single source of
 * truth shared by the API's prerender triggers/manifest and the
 * prerenderer Lambda's path mapping (they must agree byte-for-byte or a
 * publish renders one path while the CDN routes another). Returns null
 * for game reports: they keep the CloudFront-Function OG redirect and are
 * never prerendered.
 */
export function publicContentUrl(
  kind: ContentKind,
  slug: string,
  path: string | null,
): string | null {
  switch (kind) {
    case "page":
      return path;
    case "news":
      return `/news/article/${slug}`;
    case "event":
      return `/calendar/event/${slug}`;
    case "person":
      return `/person/${slug}`;
    case "game_report":
      return null;
  }
}

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
  // References a person by slug (the DB-backed person kind as of Phase 4,
  // with the static corpus as transition fallback) - only the format is
  // validated here. The admin UI's people picker is what ties the slug
  // to a real person.
  authorSlug: contentSlugSchema.optional(),
});
export type NewsMetadata = z.infer<typeof newsMetadataSchema>;

// Event timestamps historically allow ISO 8601 minute precision as well as
// seconds and fractional seconds. Keep the two forms explicit: Zod 4.5.4
// stopped accepting minute precision through the default datetime schema,
// even though it remains part of the documented default contract.
const eventDateTimeSchema = z.union([
  z.iso.datetime({ offset: true, precision: -1 }),
  z.iso.datetime({ offset: true }),
]);

export const eventMetadataSchema = z.object({
  when: eventDateTimeSchema,
  finish: eventDateTimeSchema.optional(),
  // Optional iCal recurrence. `when` is the series DTSTART; each occurrence
  // keeps the same finish-minus-when duration. Expansion (DST-correct, in
  // Europe/London) lives in ./recurrence.ts and is shared by every consumer.
  recurrence: z
    .object({
      // RRULE body only (no DTSTART line); DTSTART is the event's `when`.
      // e.g. "FREQ=WEEKLY;BYDAY=TU".
      rrule: z.string().min(1),
      // Europe/London calendar dates (yyyy-MM-dd) of occurrences to cancel.
      exceptions: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    })
    .refine((r) => {
      try {
        rrulestr(`RRULE:${r.rrule}`);
        return true;
      } catch {
        return false;
      }
    }, "Invalid recurrence rule")
    .optional(),
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

/**
 * Image sources the public site will render: https or site-relative
 * (uploads live under /uploads/*). Mirrors the public renderer's
 * isSafeImageSrc so a stored descriptor can never smuggle a protocol the
 * renderer would have to reject.
 */
const SAFE_IMAGE_SRC = /^(?:https:|\/(?!\/))/i;

const safeSrcset = z
  .string()
  .min(1)
  .refine(
    (srcset) =>
      srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .every((url) => url !== undefined && SAFE_IMAGE_SRC.test(url)),
    "Every srcset URL must be https or site-relative",
  );

/**
 * A person's profile photo: the PictureSource descriptor returned by the
 * content-images upload API (responsive srcsets per format + the largest
 * fallback image), stored inline so the public profile renders without
 * any lookup - the same precedent as the contentImage block's picture
 * prop. Alt text is not stored: the photo is always rendered with the
 * person's name as its alt.
 */
export const personPhotoSchema = z.object({
  sources: z.record(z.string(), safeSrcset),
  img: z.object({
    src: z.string().regex(SAFE_IMAGE_SRC, "Must be https or site-relative"),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
});
export type PersonPhoto = z.infer<typeof personPhotoSchema>;

/**
 * Person metadata (Phase 4, #498). The person's name lives in the item's
 * `title` column like every other kind's display name - duplicating it
 * here would create two sources of truth. The flags are
 * safeguarding-adjacent, which is why the person kind is gated by
 * content_people (people_editor / content_admin) rather than the general
 * content roles. Both flags are deliberately public: the static site has
 * always rendered the DBS badge on profiles and filtered rosters on
 * hasLeftClub, and parents being able to see who is DBS checked is the
 * point of the badge. The gate protects who can WRITE them.
 */
export const personMetadataSchema = z.object({
  isDBSChecked: z.boolean().default(false),
  hasLeftClub: z.boolean().default(false),
  photo: personPhotoSchema.optional(),
});
export type PersonMetadata = z.infer<typeof personMetadataSchema>;

export const CONTENT_METADATA_SCHEMAS: Partial<
  Record<ContentKind, z.ZodType<Record<string, unknown>>>
> = {
  page: pageMetadataSchema,
  news: newsMetadataSchema,
  event: eventMetadataSchema,
  game_report: gameReportMetadataSchema,
  person: personMetadataSchema,
};

// ── Profile self-edit proposals (#575) ──────────────────────────────────
//
// The review tier the permissions model reserved (manage vs publish on
// content_people). A slug-linked member proposes edits to ONLY the
// self-editable subset of their own person profile - the bio (body) and
// the photo; title/slug and the safeguarding flags (isDBSChecked /
// hasLeftClub) stay admin-only. The proposal awaits a content_people
// publisher's approval before it replaces the live profile content.

export const CONTENT_PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export const contentProposalStatusSchema = z.enum(CONTENT_PROPOSAL_STATUSES);
export type ContentProposalStatus = z.infer<typeof contentProposalStatusSchema>;

// ── Recurrence expansion ────────────────────────────────────────────────
export {
  EVENT_TIME_ZONE,
  expandEventOccurrences,
  latestOccurrenceBefore,
  nextOccurrence,
  occurrenceOnDate,
  recurrenceSummary,
  viewedOccurrence,
  type DateRange,
  type Occurrence,
} from "./recurrence.ts";

// ── Block-type primitives ───────────────────────────────────────────────
//
// CUSTOM_BLOCK_TYPES and blockPropValueSchema live in the leaf block-types.ts
// module (so block-catalog.ts can import them without a circular dependency on
// this entrypoint). Re-exported here so external importers keep getting them
// from "@percy-main/shared/content".
export { blockPropValueSchema, CUSTOM_BLOCK_TYPES } from "./block-types.ts";

// ── Block catalog (AI content-author) ───────────────────────────────────
export {
  AGENT_WRITABLE_BLOCK_TYPES,
  BLOCK_CATALOG,
  CONTENT_LIMITS,
  draftBlockSchema,
  draftBlocksSchema,
  editDeleteOpSchema,
  editInsertOpSchema,
  editOpSchema,
  editOpsSchema,
  editUpdateOpSchema,
  getBlockCatalogEntry,
  insertPositionSchema,
  renderBlockCatalogForPrompt,
  tableContentSchema,
  writeContentBlockSchema,
  writeContentBodySchema,
  type BlockCatalogEntry,
  type BlockContentKind,
  type DraftBlock,
  type DraftBlocks,
  type EditOp,
  type EditOps,
  type InsertPosition,
  type ResolvedBlock,
  type ResolvedEditOp,
  type TableContent,
  type WriteContentBlock,
  type WriteContentBody,
} from "./block-catalog.ts";
