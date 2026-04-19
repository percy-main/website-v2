import { z } from "zod";

export const platformSchema = z.enum(["facebook", "instagram"]);

export const matchIdParamSchema = z.object({
  matchId: z.string(),
});

export const retryParamsSchema = z.object({
  matchId: z.string(),
  platform: platformSchema,
});

export const retryBodySchema = z.object({
  isHome: z.boolean(),
  matchTime: z.string().nullable(),
});

export const reconcileBodySchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("posted"),
    externalPostId: z.string().min(1),
  }),
  z.object({
    outcome: z.literal("failed"),
  }),
]);

// ── Response schemas ──

const publicationRowSchema = z.object({
  id: z.string(),
  matchday_id: z.string(),
  platform: z.string(),
  state: z.string(),
  claimed_at: z.string(),
  posted_at: z.string().nullable(),
  external_post_id: z.string().nullable(),
  caption: z.string(),
  caption_source: z.string(),
  image_url: z.string(),
  last_error: z.string().nullable(),
  attempt_count: z.number(),
  updated_at: z.string(),
});

export const socialPublicationsResponseSchema = z.object({
  items: z.array(publicationRowSchema),
});

export const retryResponseSchema = z.object({
  state: z.enum(["posted", "failed", "already_posted", "in_flight"]),
  externalPostId: z.string().optional(),
  error: z.string().optional(),
});

export const reconcileResponseSchema = z.object({
  state: z.enum(["posted", "failed"]),
});

// ── Types ──

export type Platform = z.infer<typeof platformSchema>;
export type RetryBody = z.infer<typeof retryBodySchema>;
export type ReconcileBody = z.infer<typeof reconcileBodySchema>;
