import { z } from "zod";

export const CONTENT_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

// ── Upload URL ──────────────────────────────────────────────────────────

export const uploadUrlSchema = z.object({
  contentType: z.enum(CONTENT_IMAGE_CONTENT_TYPES),
  /**
   * The uploader must confirm photo consent (especially for juniors)
   * before a presigned URL is ever issued; it is re-asserted and stored
   * on the confirm call.
   */
  consentConfirmed: z.literal(true),
});

export const uploadUrlResponseSchema = z.object({
  imageId: z.string(),
  uploadUrl: z.string(),
  pendingKey: z.string(),
  maxBytes: z.number().int(),
});

// ── Confirm (process + register) ────────────────────────────────────────

export const confirmUploadSchema = z.object({
  imageId: z.uuid(),
  pendingKey: z.string().min(1).max(500),
  consentConfirmed: z.literal(true),
  alt: z.string().min(1).max(500).nullish(),
});

/** Matches the frontend PictureSource shape consumed by OptimisedImage. */
export const pictureSourceSchema = z.object({
  sources: z.record(z.string(), z.string()),
  img: z.object({
    src: z.string(),
    w: z.number().int(),
    h: z.number().int(),
  }),
});

export const contentImageResponseSchema = z.object({
  id: z.string(),
  picture: pictureSourceSchema,
  alt: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
});
