/**
 * One-off migration (#491): import the legacy MDX news articles and
 * events into the content API's tables as published items, pushing each
 * embedded <Image> through the same processing pipeline as editor
 * uploads (responsive WebP ladder + original-format fallback in S3,
 * registered in content_image).
 *
 * Idempotent: upserts by kind+slug. Unchanged items are skipped; image
 * ids are UUIDv5-derived from the source asset path, so re-runs reuse
 * the same S3 keys and content_image rows. Items that differ from the
 * DB are skipped with a warning unless --force (the DB is canonical
 * after cutover).
 *
 * Usage (local):
 *   DATABASE_URL=postgres://percy:percy@localhost:5433/percy_main \
 *     S3_BUCKET=percy-main-receipts-local \
 *     S3_ENDPOINT=http://localhost:4566 \
 *     AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
 *     pnpm exec tsx scripts/migrate-news-events.ts --user <user-id> [--dry-run] [--force]
 *
 * Environment:
 *   DATABASE_URL  required always (dry runs read existing rows).
 *   S3_BUCKET     required unless --dry-run; the CloudFront uploads
 *                 bucket (prod: see infra outputs; local: the
 *                 percy-main-receipts-local LocalStack bucket).
 *   S3_REGION     optional, defaults to eu-west-2.
 *   S3_ENDPOINT   optional; set to http://localhost:4566 for LocalStack.
 *   AWS credentials come from the SDK default chain - for a real prod
 *   run set AWS_PROFILE=percy-main (matching the CLI profile rule).
 *
 * Against prod, run with the standard prod access pattern and the
 * admin_rw URL - coordinate first; never point this at prod casually.
 */
import { createClient } from "@percy-main/db";
import {
  contentSlugSchema,
  eventMetadataSchema,
  newsMetadataSchema,
} from "@percy-main/shared/content";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import {
  processImage,
  type ProcessedImage,
} from "../src/features/content-images/service.ts";
import {
  CONTENT_IMAGES_PREFIX,
  createContentImageStore,
  type ContentImageStore,
} from "../src/lib/s3-content-images.ts";
import {
  blocksEqualIgnoringIds,
  type MigrationBlock,
} from "./markdown-to-blocks.ts";
import {
  eventPublishedAt,
  findDuplicateLocationNames,
  imageIdForAsset,
  jsonEqual,
  mdxToBlocks,
  newsPublishedAt,
  parseEventSource,
  parseNewsSource,
  resolveLocation,
  type RawLocation,
} from "./mdx-to-blocks.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWS_DIR = path.resolve(__dirname, "../../web/content/news");
const EVENTS_DIR = path.resolve(__dirname, "../../web/content/events");
const LOCATIONS_FILE = path.resolve(
  __dirname,
  "../../web/content/data/locations.yaml",
);
// Mirrors the web app's image-map: public "/images/..." paths resolve to
// files under src/assets/images/.
const ASSETS_DIR = path.resolve(__dirname, "../../web/src/assets/images");

function parseArgs() {
  const args = process.argv.slice(2);
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  if (!userId) {
    console.error(
      "Usage: tsx scripts/migrate-news-events.ts --user <user-id> [--dry-run] [--force]",
    );
    process.exit(1);
  }
  return { userId, dryRun, force };
}

class MissingImageError extends Error {
  constructor(publicPath: string) {
    super(`image file not found on disk for '${publicPath}'`);
  }
}

interface PendingImage {
  imageId: string;
  publicPath: string;
  alt: string | null;
  processed: ProcessedImage;
  bytes: number;
}

interface Converted {
  blocks: MigrationBlock[];
  images: PendingImage[];
}

/**
 * Convert one MDX body, resolving each <Image> through the editor-upload
 * processing pipeline (locally - nothing is written here, so --dry-run
 * conversion is complete and writes can be deferred until after the
 * skip/insert decision). The processed-image cache spans articles so a
 * re-used asset is only decoded once.
 */
async function convertBody(
  body: string,
  cache: Map<string, PendingImage>,
): Promise<Converted> {
  const images: PendingImage[] = [];
  const blocks = await mdxToBlocks(body, async ({ src, alt, caption }) => {
    const imageId = imageIdForAsset(src);
    let pending = cache.get(imageId);
    if (!pending) {
      if (!src.startsWith("/images/")) {
        throw new Error(`unexpected image src '${src}'`);
      }
      const assetPath = path.join(ASSETS_DIR, src.slice("/images/".length));
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
      pending = {
        imageId,
        publicPath: src,
        alt: alt ?? null,
        processed,
        bytes: original.byteLength,
      };
      cache.set(imageId, pending);
    }
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

interface MigrationItem {
  file: string;
  kind: "news" | "event";
  slug: string;
  title: string;
  metadata: Record<string, unknown>;
  publishedAt: Date;
  /** Semantic equality for an existing row's published_at. */
  publishedAtMatches: (existing: Date) => boolean;
  converted: Converted;
}

interface Counts {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

async function main() {
  const { userId, dryRun, force } = parseArgs();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  // The store is only needed for real runs - a dry run must not touch S3.
  let store: ContentImageStore | null = null;
  if (!dryRun) {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      console.error("S3_BUCKET is required (omit only with --dry-run)");
      process.exit(1);
    }
    store = createContentImageStore({
      S3_BUCKET: bucket,
      S3_REGION: process.env.S3_REGION ?? "eu-west-2",
      S3_ENDPOINT: process.env.S3_ENDPOINT,
      // Unused here (no presigned uploads) but part of the store config.
      CONTENT_IMAGE_UPLOAD_URL_EXPIRY_SECONDS: 900,
    });
  }

  const { client: db } = createClient(databaseUrl);

  const attributedTo = await db
    .selectFrom("user")
    .select(["name", "email"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!attributedTo) {
    console.error(`No user with id '${userId}'`);
    await db.destroy();
    process.exit(1);
  }
  console.log(
    `Attributing imports to: ${attributedTo.name} <${attributedTo.email}>`,
  );

  const locations = YAML.parse(
    await fs.readFile(LOCATIONS_FILE, "utf8"),
  ) as RawLocation[];
  // Informational, not counted as a migration warning: the duplicate does
  // not block any item (first match wins, see resolveLocation).
  for (const name of findDuplicateLocationNames(locations)) {
    console.warn(
      `note: locations.yaml contains duplicate entries for '${name}' - using the first one`,
    );
  }

  let warnings = 0;
  const counts: Record<"news" | "event", Counts> = {
    news: { inserted: 0, updated: 0, unchanged: 0, skipped: 0 },
    event: { inserted: 0, updated: 0, unchanged: 0, skipped: 0 },
  };
  let imagesUploaded = 0;
  let imagesReused = 0;
  const imageCache = new Map<string, PendingImage>();
  // Dry-run only: ids already reported as "would upload", so an asset
  // shared by two articles is not double-counted.
  const plannedUploads = new Set<string>();
  const now = new Date();

  const warn = (message: string) => {
    warnings += 1;
    console.warn(`  ! ${message}`);
  };

  // ── Gather + convert ──────────────────────────────────────────────────

  const items: MigrationItem[] = [];

  const newsFiles = (await fs.readdir(NEWS_DIR, { recursive: true }))
    .filter((f) => f.endsWith(".mdx"))
    .sort();
  console.log(`Found ${String(newsFiles.length)} news articles in ${NEWS_DIR}`);

  for (const file of newsFiles) {
    try {
      const source = await fs.readFile(path.join(NEWS_DIR, file), "utf8");
      const parsed = parseNewsSource(source);
      contentSlugSchema.parse(parsed.slug);
      const metadata = newsMetadataSchema.parse({
        tags: parsed.tags,
        ...(parsed.author !== undefined && { authorSlug: parsed.author }),
      });
      const publishedAt = newsPublishedAt(parsed.date);
      items.push({
        file: `news/${file}`,
        kind: "news",
        slug: parsed.slug,
        title: parsed.title,
        metadata,
        publishedAt,
        publishedAtMatches: (existing) =>
          existing.getTime() === publishedAt.getTime(),
        converted: await convertBody(parsed.body, imageCache),
      });
    } catch (err) {
      warn(
        `news/${file}: ${err instanceof Error ? err.message : String(err)} - skipping`,
      );
    }
  }

  const eventFiles = (await fs.readdir(EVENTS_DIR))
    .filter((f) => f.endsWith(".mdx"))
    .sort();
  console.log(`Found ${String(eventFiles.length)} events in ${EVENTS_DIR}`);

  for (const file of eventFiles) {
    try {
      const source = await fs.readFile(path.join(EVENTS_DIR, file), "utf8");
      const parsed = parseEventSource(source);
      const slug = file.replace(/\.mdx$/, "");
      contentSlugSchema.parse(slug);

      let location;
      if (parsed.location !== undefined) {
        location = resolveLocation(locations, parsed.location);
        if (!location) {
          warn(
            `events/${file}: location '${parsed.location}' not found in locations.yaml - omitting location`,
          );
        }
      }
      const metadata = eventMetadataSchema.parse({
        when: parsed.when,
        ...(parsed.finish !== undefined && { finish: parsed.finish }),
        ...(location !== undefined && { location }),
      });
      const start = new Date(parsed.when).getTime();
      items.push({
        file: `events/${file}`,
        kind: "event",
        slug,
        title: parsed.name,
        metadata,
        publishedAt: eventPublishedAt(parsed.when, now),
        // Any "live from" at or before both the event start and now is
        // semantically the same: the item is publicly visible, and event
        // ordering comes from metadata.when, not published_at.
        publishedAtMatches: (existing) =>
          existing.getTime() <= start && existing.getTime() <= now.getTime(),
        converted: await convertBody(parsed.body, imageCache),
      });
    } catch (err) {
      warn(
        `events/${file}: ${err instanceof Error ? err.message : String(err)} - skipping`,
      );
    }
  }

  // ── Upsert ────────────────────────────────────────────────────────────

  /** Upload variants + register rows for an article's images (idempotent). */
  const ensureImages = async (images: PendingImage[]) => {
    if (!store) throw new Error("store unavailable outside a real run");
    for (const image of images) {
      const existing = await db
        .selectFrom("content_image")
        .select("id")
        .where("id", "=", image.imageId)
        .executeTakeFirst();
      if (existing) {
        imagesReused += 1;
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
      imagesUploaded += 1;
      console.log(
        `    ^ uploaded ${image.publicPath} -> ${CONTENT_IMAGES_PREFIX}/${image.imageId}/ (${String(image.processed.variants.length)} variants)`,
      );
    }
  };

  for (const item of items) {
    const tally = counts[item.kind];
    const { blocks, images } = item.converted;

    const existing = await db
      .selectFrom("content_item")
      .select([
        "id",
        "body",
        "title",
        "description",
        "metadata",
        "status",
        "published_at",
      ])
      .where("kind", "=", item.kind)
      .where("slug", "=", item.slug)
      .executeTakeFirst();

    if (existing) {
      // Same stance as the game-reports migration: a non-published row
      // would still 404 publicly, and a published row an editor may have
      // touched is only overwritten under --force (post-cutover the DB
      // is canonical and the MDX is the stale ancestor).
      if (existing.status !== "published") {
        tally.skipped += 1;
        warn(
          `${item.file}: a ${existing.status} item already exists at ${item.kind}/${item.slug} - the public endpoint will 404. Publish or remove it, then re-run.`,
        );
        continue;
      }
      const unchanged =
        blocksEqualIgnoringIds(existing.body, blocks) &&
        existing.title === item.title &&
        existing.description === null &&
        jsonEqual(existing.metadata, item.metadata) &&
        existing.published_at !== null &&
        item.publishedAtMatches(existing.published_at);
      if (unchanged) {
        tally.unchanged += 1;
        console.log(`  = ${item.file} unchanged (${existing.title})`);
        continue;
      }
      if (!force) {
        tally.skipped += 1;
        warn(
          `${item.file}: published item '${existing.title}' differs from the MDX conversion (likely edited in the DB). Skipping - re-run with --force to overwrite.`,
        );
        continue;
      }
    }

    if (dryRun) {
      const newImages = [];
      for (const image of images) {
        if (plannedUploads.has(image.imageId)) continue;
        const row = await db
          .selectFrom("content_image")
          .select("id")
          .where("id", "=", image.imageId)
          .executeTakeFirst();
        if (row) {
          imagesReused += 1;
        } else {
          newImages.push(image);
          plannedUploads.add(image.imageId);
        }
      }
      console.log(
        `  ~ ${item.file} would ${existing ? "update" : "insert"} '${item.title}' (${String(blocks.length)} blocks, ${String(images.length)} images, published_at ${item.publishedAt.toISOString()})`,
      );
      for (const image of newImages) {
        console.log(
          `    ~ would upload ${image.publicPath} -> ${CONTENT_IMAGES_PREFIX}/${image.imageId}/ (${String(image.processed.variants.length)} variants)`,
        );
      }
      imagesUploaded += newImages.length;
      continue;
    }

    // Images first: like the editor flow, content_image rows + variants
    // exist before any body referencing them is saved. Deferred to this
    // point so skipped articles write nothing at all.
    await ensureImages(images);

    await db.transaction().execute(async (tx) => {
      if (existing) {
        await tx
          .updateTable("content_item")
          .set({
            title: item.title,
            description: null,
            body: JSON.stringify(blocks),
            metadata: JSON.stringify(item.metadata),
            published_at: item.publishedAt,
            updated_by: userId,
            updated_at: new Date(),
          })
          .where("id", "=", existing.id)
          .execute();
        await tx
          .insertInto("content_revision")
          .values({
            content_id: existing.id,
            title: item.title,
            description: null,
            body: JSON.stringify(blocks),
            metadata: JSON.stringify(item.metadata),
            saved_by: userId,
          })
          .execute();
        tally.updated += 1;
        console.log(`  ^ ${item.file} updated (${item.title})`);
        return;
      }

      const inserted = await tx
        .insertInto("content_item")
        .values({
          kind: item.kind,
          slug: item.slug,
          title: item.title,
          description: null,
          body: JSON.stringify(blocks),
          metadata: JSON.stringify(item.metadata),
          status: "published",
          published_at: item.publishedAt,
          created_by: userId,
          updated_by: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("content_revision")
        .values({
          content_id: inserted.id,
          title: item.title,
          description: null,
          body: JSON.stringify(blocks),
          metadata: JSON.stringify(item.metadata),
          saved_by: userId,
        })
        .execute();
      tally.inserted += 1;
      console.log(`  + ${item.file} inserted as '${item.title}'`);
    });
  }

  const summarise = (label: string, c: Counts) =>
    `${label}: ${String(c.inserted)} inserted, ${String(c.updated)} updated, ${String(c.unchanged)} unchanged, ${String(c.skipped)} skipped`;
  console.log(summarise("News", counts.news));
  console.log(summarise("Events", counts.event));
  console.log(
    `Images: ${String(imagesUploaded)} ${dryRun ? "would be uploaded" : "uploaded"}, ${String(imagesReused)} reused`,
  );
  console.log(
    `Done with ${String(warnings)} warnings${dryRun ? " (dry run)" : ""}`,
  );
  if (warnings > 0) process.exitCode = 2;
  await db.destroy();
}

await main();
