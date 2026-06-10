import {
  blockPropValueSchema,
  contentKindSchema,
  contentSlugSchema,
  contentStatusSchema,
} from "@percy-main/shared/content";
import { z } from "zod";

// ── Shared shapes ───────────────────────────────────────────────────────

/**
 * Kind-specific metadata. Each kind's concrete schema lives in
 * packages/shared (CONTENT_METADATA_SCHEMAS) and is enforced by the
 * service on every write; at the transport layer it is an open object.
 */
export const contentMetadataSchema = z.record(z.string(), z.unknown());

/**
 * Transport-level body schema: one level of the BlockNote block envelope
 * with children left opaque. The fully recursive schema
 * (contentBodySchema in packages/shared) produces self-referencing $refs
 * that openapi-typescript cannot resolve, so the route layer validates
 * depth 1 and the service re-validates the whole tree recursively on
 * every write.
 */
const transportBlockSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.string(), blockPropValueSchema),
  content: z.unknown().optional(),
  children: z.array(z.unknown()),
});

export const contentBodyTransportSchema = z.array(transportBlockSchema);

export const contentSummarySchema = z.object({
  id: z.string(),
  kind: contentKindSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: contentStatusSchema,
  metadata: contentMetadataSchema,
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
  updatedByName: z.string().nullable(),
});

export const contentDetailSchema = contentSummarySchema.extend({
  body: contentBodyTransportSchema,
});

// ── Admin: list ─────────────────────────────────────────────────────────

export const listContentQuerySchema = z.object({
  kind: contentKindSchema,
  status: contentStatusSchema.optional(),
  search: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const listContentResponseSchema = z.object({
  items: z.array(contentSummarySchema),
  total: z.number().int().nonnegative(),
});

// ── Admin: get / create / update ────────────────────────────────────────

export const contentIdParamSchema = z.object({
  contentId: z.uuid(),
});

export const createContentSchema = z.object({
  kind: contentKindSchema,
  slug: contentSlugSchema,
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(1000).nullish(),
  body: contentBodyTransportSchema,
  metadata: contentMetadataSchema,
});

export const updateContentSchema = z.object({
  slug: contentSlugSchema.optional(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().min(1).max(1000).nullish(),
  body: contentBodyTransportSchema.optional(),
  metadata: contentMetadataSchema.optional(),
});

export const contentDetailResponseSchema = contentDetailSchema;

// ── Admin: publish / unpublish / archive ────────────────────────────────

export const publishContentSchema = z
  .object({
    /** Omit to publish immediately; a future datetime schedules it. */
    publishedAt: z.iso.datetime({ offset: true }).optional(),
  })
  // Optional so "publish now" needs no request body at all.
  .optional();

// ── Admin: revisions ────────────────────────────────────────────────────

export const listRevisionsResponseSchema = z.object({
  revisions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      savedAt: z.string(),
      savedBy: z.string(),
      savedByName: z.string().nullable(),
    }),
  ),
});

// ── Public ──────────────────────────────────────────────────────────────

export const publicContentParamsSchema = z.object({
  kind: contentKindSchema,
  slug: contentSlugSchema,
});

export const playCricketIdParamSchema = z.object({
  playCricketId: z.string().min(1).max(50),
});

export const publicContentResponseSchema = z.object({
  id: z.string(),
  kind: contentKindSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  body: contentBodyTransportSchema,
  metadata: contentMetadataSchema,
  publishedAt: z.string(),
  updatedAt: z.string(),
});

// ── Public: lists ───────────────────────────────────────────────────────

/** List item: summary fields only - bodies stay on the single-item routes. */
const publicListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  metadata: contentMetadataSchema,
  publishedAt: z.string(),
  updatedAt: z.string(),
});

export const listNewsQuerySchema = z.object({
  tag: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(5),
});

export const listNewsResponseSchema = z.object({
  items: z.array(publicListItemSchema),
  total: z.number().int().nonnegative(),
  /** Tag counts across all published news (never narrowed by ?tag). */
  tags: z.array(
    z.object({
      tag: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /** "YYYY-MM" months (Europe/London) across all published news. */
  archive: z.array(
    z.object({
      month: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  authorCount: z.number().int().nonnegative(),
});

export const listEventsResponseSchema = z.object({
  items: z.array(publicListItemSchema),
});
