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
  CONTENT_IMAGES_PREFIX,
  createContentImageStore,
  type ContentImageStore,
} from "../src/lib/s3-content-images.ts";
import {
  convertBody,
  ensureImages as ensureImagesShared,
  planImageUploads,
  type Converted,
  type PendingImage,
} from "./image-pipeline.ts";
import { blocksEqualIgnoringIds } from "./markdown-to-blocks.ts";
import {
  eventPublishedAt,
  findDuplicateLocationNames,
  jsonEqual,
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
    const { uploaded, reused } = await ensureImagesShared(
      db,
      store,
      userId,
      images,
    );
    imagesUploaded += uploaded;
    imagesReused += reused;
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
      const { newImages, reused } = await planImageUploads(
        db,
        images,
        plannedUploads,
      );
      imagesReused += reused;
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
  if (warnings > 0) {
    // Partial migrations have a sharp edge: the public news list and
    // calendar switch from the bundled static corpus to DB-only content
    // as soon as ANY migrated content exists, so skipped items vanish
    // from the public site rather than falling back.
    console.warn(
      "NOTE: skipped items will NOT appear on the public site once any " +
        "migrated content exists - the news list and calendar serve DB " +
        "content only from that point. Resolve the warnings above and " +
        "re-run before considering the migration done.",
    );
    process.exitCode = 2;
  }
  await db.destroy();
}

await main();
