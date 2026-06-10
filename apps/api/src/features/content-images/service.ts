import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import sharp from "sharp";
import type { Config } from "../../config.ts";
import {
  CONTENT_IMAGE_PENDING_PREFIX,
  CONTENT_IMAGES_PREFIX,
  type ContentImageStore,
} from "../../lib/s3-content-images.ts";

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

/**
 * Responsive ladder widths, matching what vite-imagetools generates for
 * the static corpus. Widths larger than the source are skipped (no
 * upscaling); the source width itself caps the largest variant.
 */
const LADDER_WIDTHS = [320, 640, 960, 1280, 1920] as const;

/** Modern formats every image gets, in <picture> source order. */
const MODERN_FORMATS = ["avif", "webp"] as const;

/**
 * Input formats sharp can decode here. HEIC is accepted at presign time
 * (iPhones produce it) but the prebuilt sharp binaries cannot decode
 * HEVC-compressed HEIC, so it fails at processing with a clear message
 * rather than silently - most iOS browsers transcode to JPEG on upload
 * anyway.
 */
const DECODABLE_FORMATS = new Set(["jpeg", "png", "webp"]);

const FALLBACK_CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export interface ProcessedVariant {
  key: string;
  format: string;
  width: number;
  height: number;
  body: Buffer;
  contentType: string;
}

export interface ProcessedImage {
  variants: ProcessedVariant[];
  picture: {
    sources: Record<string, string>;
    img: { src: string; w: number; h: number };
  };
  sourceFormat: string;
  width: number;
  height: number;
}

/**
 * Decode + validate the original, then build the full responsive ladder:
 * AVIF + WebP at each ladder width plus an original-format fallback at
 * the largest width. EXIF/GPS and all other metadata are stripped by
 * construction - sharp only carries metadata through when withMetadata()
 * is called, which it never is here. Orientation is applied to pixels
 * (rotate()) before the EXIF that described it is dropped.
 */
export async function processImage(
  original: Buffer,
  imageId: string,
  publicPrefix: string,
): Promise<ProcessedImage> {
  let meta;
  try {
    meta = await sharp(original).metadata();
  } catch {
    throwHttpError(400, "File is not a decodable image");
  }

  const format = meta.format ?? "unknown";
  if (!DECODABLE_FORMATS.has(format)) {
    throwHttpError(
      400,
      format === "heif"
        ? "HEIC images can't be processed here - please convert to JPEG and re-upload"
        : `Unsupported image format '${format}' - use JPEG, PNG or WebP`,
    );
  }

  // rotate() with no args applies the EXIF orientation to the pixels, so
  // the stored variants render upright everywhere with no metadata.
  const base = sharp(original).rotate();
  const { width: sourceWidth, height: sourceHeight } = orientedDimensions(
    meta.width ?? 0,
    meta.height ?? 0,
    meta.orientation,
  );
  if (sourceWidth === 0 || sourceHeight === 0) {
    throwHttpError(400, "Image has no measurable dimensions");
  }

  const widths: number[] = LADDER_WIDTHS.filter((w) => w <= sourceWidth);
  if (widths.length === 0) widths.push(Math.min(sourceWidth, 320));
  const largest = widths[widths.length - 1] ?? sourceWidth;

  const variants: ProcessedVariant[] = [];

  for (const targetFormat of MODERN_FORMATS) {
    for (const width of widths) {
      const pipeline = base.clone().resize({ width, withoutEnlargement: true });
      const encoded =
        targetFormat === "avif"
          ? pipeline.avif({ quality: 60 })
          : pipeline.webp({ quality: 80 });
      const { data, info } = await encoded.toBuffer({
        resolveWithObject: true,
      });
      variants.push({
        key: `${publicPrefix}/${imageId}/${String(width)}.${targetFormat}`,
        format: targetFormat,
        width: info.width,
        height: info.height,
        body: data,
        contentType: `image/${targetFormat}`,
      });
    }
  }

  // Original-format fallback at the largest ladder width, for browsers
  // that take the <img> src directly.
  const fallback = await base
    .clone()
    .resize({ width: largest, withoutEnlargement: true })
    .toFormat(format)
    .toBuffer({ resolveWithObject: true });
  const fallbackKey = `${publicPrefix}/${imageId}/${String(largest)}.${format === "jpeg" ? "jpg" : format}`;
  variants.push({
    key: fallbackKey,
    format,
    width: fallback.info.width,
    height: fallback.info.height,
    body: fallback.data,
    contentType: FALLBACK_CONTENT_TYPES[format] ?? "application/octet-stream",
  });

  const sources: Record<string, string> = {};
  for (const targetFormat of MODERN_FORMATS) {
    sources[targetFormat] = variants
      .filter((v) => v.format === targetFormat)
      .map((v) => `/${v.key} ${String(v.width)}w`)
      .join(", ");
  }

  return {
    variants,
    picture: {
      sources,
      img: {
        src: `/${fallbackKey}`,
        w: fallback.info.width,
        h: fallback.info.height,
      },
    },
    sourceFormat: format,
    width: sourceWidth,
    height: sourceHeight,
  };
}

/** EXIF orientations 5-8 swap the visual width/height. */
function orientedDimensions(
  width: number,
  height: number,
  orientation: number | undefined,
): { width: number; height: number } {
  if (orientation !== undefined && orientation >= 5) {
    return { width: height, height: width };
  }
  return { width, height };
}

// ── Upload URL ──────────────────────────────────────────────────────────

export function createUploadUrl(store: ContentImageStore, config: Config) {
  return async (params: { contentType: string }) => {
    const imageId = crypto.randomUUID();
    const extension = EXTENSIONS[params.contentType] ?? "bin";
    const { uploadUrl, pendingKey } = await store.getSignedUploadUrl(
      imageId,
      extension,
      params.contentType,
    );
    return {
      imageId,
      uploadUrl,
      pendingKey,
      maxBytes: config.CONTENT_IMAGE_MAX_BYTES,
    };
  };
}

// ── Confirm: process, write variants, register ──────────────────────────

export function confirmUpload(
  db: Kysely<DB>,
  store: ContentImageStore,
  config: Config,
) {
  return async (params: {
    imageId: string;
    pendingKey: string;
    alt?: string | null;
    userId: string;
  }) => {
    // The pending key must be one this feature issued: under our pending
    // prefix and named by the caller's imageId. Prevents pointing the
    // processor at arbitrary bucket objects.
    const expectedPrefix = `${CONTENT_IMAGE_PENDING_PREFIX}/${params.imageId}.`;
    if (!params.pendingKey.startsWith(expectedPrefix)) {
      throwHttpError(400, "pendingKey does not match imageId");
    }

    const tooLarge = async () => {
      await store.deletePending(params.pendingKey);
      throwHttpError(
        400,
        `Image is too large - maximum size is ${String(Math.floor(config.CONTENT_IMAGE_MAX_BYTES / (1024 * 1024)))}MB`,
      );
    };

    const head = await store.headPending(params.pendingKey);
    if (!head) {
      throwHttpError(404, "Uploaded file not found - upload may have expired");
    }
    if (head.contentLength > config.CONTENT_IMAGE_MAX_BYTES) {
      await tooLarge();
    }

    const original = await store.getPending(params.pendingKey);
    // Re-check actual bytes: a presigned URL can be reused between the
    // HEAD and the GET, so the HEAD's content-length is advisory only.
    if (original.byteLength > config.CONTENT_IMAGE_MAX_BYTES) {
      await tooLarge();
    }

    let processed;
    try {
      processed = await processImage(
        original,
        params.imageId,
        CONTENT_IMAGES_PREFIX,
      );
    } catch (err) {
      // A 400 here is a verdict on the uploaded bytes (corrupt, GIF,
      // HEIC...): the pending object is permanently useless, so clean it
      // up now instead of waiting for lifecycle expiry.
      if ((err as { statusCode?: number }).statusCode === 400) {
        await store.deletePending(params.pendingKey);
      }
      throw err;
    }

    for (const variant of processed.variants) {
      await store.putVariant(variant.key, variant.body, variant.contentType);
    }

    const alt = params.alt ?? null;
    const keyPrefix = `${CONTENT_IMAGES_PREFIX}/${params.imageId}`;

    await db
      .insertInto("content_image")
      .values({
        id: params.imageId,
        key_prefix: keyPrefix,
        original_format: processed.sourceFormat,
        width: processed.width,
        height: processed.height,
        bytes: original.byteLength,
        picture: JSON.stringify(processed.picture),
        alt,
        consent_confirmed: true,
        uploaded_by: params.userId,
      })
      .execute();

    // Deleted last: if the row insert fails the original survives, so a
    // retry of the confirm call can succeed (variant keys are
    // deterministic and simply get overwritten).
    await store.deletePending(params.pendingKey);

    return {
      id: params.imageId,
      picture: processed.picture,
      alt,
      width: processed.width,
      height: processed.height,
    };
  };
}
