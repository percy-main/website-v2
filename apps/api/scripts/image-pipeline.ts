import type { DB } from "@percy-main/db";
import { promises as fs } from "fs";
import type { Kysely } from "kysely";
import path from "path";
import { fileURLToPath } from "url";
import {
  processImage,
  type ProcessedImage,
} from "../src/features/content-images/service.ts";
import {
  CONTENT_IMAGES_PREFIX,
  type ContentImageStore,
} from "../src/lib/s3-content-images.ts";
import type { MigrationBlock } from "./markdown-to-blocks.ts";
import { imageIdForAsset, mdxToBlocks } from "./mdx-to-blocks.ts";

// Shared <Image> handling for the MDX content migrations (#491 news +
// events, #496 pages): every corpus references its images by public
// "/images/..." path, which the web app's image-map resolves to files
// under src/assets/images/. Each one goes through the same processing
// pipeline as editor uploads (responsive WebP ladder + original-format
// fallback in S3, registered in content_image), with UUIDv5 ids derived
// from the source path so re-runs are idempotent.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "../../web/src/assets/images");

export class MissingImageError extends Error {
  constructor(publicPath: string) {
    super(`image file not found on disk for '${publicPath}'`);
  }
}

export interface PendingImage {
  imageId: string;
  publicPath: string;
  alt: string | null;
  processed: ProcessedImage;
  bytes: number;
}

export interface Converted {
  blocks: MigrationBlock[];
  images: PendingImage[];
}

/**
 * Run one "/images/..." asset through the editor-upload processing
 * pipeline (locally - nothing is written here, so --dry-run conversion
 * is complete and writes can be deferred until after the skip/insert
 * decision). The cache spans items so a re-used asset is only decoded
 * once. Used for body <Image> tags and for frontmatter photos (people
 * profiles, #498) alike.
 */
export async function prepareAsset(
  src: string,
  alt: string | null,
  cache: Map<string, PendingImage>,
): Promise<PendingImage> {
  const imageId = imageIdForAsset(src);
  const cached = cache.get(imageId);
  if (cached) return cached;

  if (!src.startsWith("/images/")) {
    throw new Error(`unexpected image src '${src}'`);
  }
  const assetPath = path.resolve(ASSETS_DIR, src.slice("/images/".length));
  // A '..' segment in the src could otherwise resolve outside the
  // bundled assets tree and upload an arbitrary readable file.
  if (!assetPath.startsWith(ASSETS_DIR + path.sep)) {
    throw new Error(`image src '${src}' escapes the assets directory`);
  }
  let original: Buffer;
  try {
    original = await fs.readFile(assetPath);
  } catch {
    throw new MissingImageError(src);
  }
  const processed = await processImage(
    original,
    imageId,
    CONTENT_IMAGES_PREFIX,
  );
  const pending: PendingImage = {
    imageId,
    publicPath: src,
    alt,
    processed,
    bytes: original.byteLength,
  };
  cache.set(imageId, pending);
  return pending;
}

/**
 * Convert one MDX body, resolving each <Image> through prepareAsset.
 */
export async function convertBody(
  body: string,
  cache: Map<string, PendingImage>,
): Promise<Converted> {
  const images: PendingImage[] = [];
  const blocks = await mdxToBlocks(body, async ({ src, alt, caption }) => {
    const pending = await prepareAsset(src, alt ?? null, cache);
    images.push(pending);
    // Exactly the prop set the editor inserts (content-editor.tsx): the
    // plain src falls back to the ladder's largest original-format
    // variant, picture carries the JSON-stringified PictureSource.
    return {
      src: pending.processed.picture.img.src,
      alt: alt ?? "",
      caption: caption ?? "",
      picture: JSON.stringify(pending.processed.picture),
    };
  });
  return { blocks, images };
}

/**
 * Upload variants + register rows for an item's images (idempotent -
 * existing content_image rows are reused). Returns the upload/reuse
 * tallies for the run summary.
 */
export async function ensureImages(
  db: Kysely<DB>,
  store: ContentImageStore,
  userId: string,
  images: PendingImage[],
): Promise<{ uploaded: number; reused: number }> {
  let uploaded = 0;
  let reused = 0;
  for (const image of images) {
    const existing = await db
      .selectFrom("content_image")
      .select("id")
      .where("id", "=", image.imageId)
      .executeTakeFirst();
    if (existing) {
      reused += 1;
      continue;
    }
    for (const variant of image.processed.variants) {
      await store.putVariant(variant.key, variant.body, variant.contentType);
    }
    await db
      .insertInto("content_image")
      .values({
        id: image.imageId,
        key_prefix: `${CONTENT_IMAGES_PREFIX}/${image.imageId}`,
        original_format: image.processed.sourceFormat,
        width: image.processed.width,
        height: image.processed.height,
        bytes: image.bytes,
        picture: JSON.stringify(image.processed.picture),
        alt: image.alt,
        consent_confirmed: true,
        uploaded_by: userId,
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    uploaded += 1;
    console.log(
      `    ^ uploaded ${image.publicPath} -> ${CONTENT_IMAGES_PREFIX}/${image.imageId}/ (${String(image.processed.variants.length)} variants)`,
    );
  }
  return { uploaded, reused };
}

/**
 * Dry-run counterpart of ensureImages: split an item's images into
 * would-upload (new) and reused, deduplicating across items via the
 * caller's plannedUploads set so a shared asset is only counted once.
 */
export async function planImageUploads(
  db: Kysely<DB>,
  images: PendingImage[],
  plannedUploads: Set<string>,
): Promise<{ newImages: PendingImage[]; reused: number }> {
  const newImages: PendingImage[] = [];
  let reused = 0;
  for (const image of images) {
    if (plannedUploads.has(image.imageId)) continue;
    const row = await db
      .selectFrom("content_image")
      .select("id")
      .where("id", "=", image.imageId)
      .executeTakeFirst();
    if (row) {
      reused += 1;
    } else {
      newImages.push(image);
      plannedUploads.add(image.imageId);
    }
  }
  return { newImages, reused };
}
