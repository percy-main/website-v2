/**
 * One-off migration (#499): import the legacy MDX people profiles into
 * the content API's tables as published person items. The frontmatter
 * maps onto title (name) + person metadata (isDBSChecked / hasLeftClub /
 * photo); the bio body converts to blocks; the profile photo goes
 * through the same processing pipeline as editor uploads, with consent
 * recorded as confirmed (pre-existing content - the consent workflow
 * applies to new editor uploads).
 *
 * Idempotent: upserts by (kind=person, slug). Unchanged items are
 * skipped; image ids are UUIDv5-derived from the source asset path, so
 * re-runs reuse the same S3 keys and content_image rows. Items that
 * differ from the DB are skipped with a warning unless --force (the DB
 * is canonical after cutover).
 *
 * Usage (local):
 *   DATABASE_URL=postgres://percy:percy@localhost:5433/percy_main \
 *     S3_BUCKET=percy-main-receipts-local \
 *     S3_ENDPOINT=http://localhost:4566 \
 *     AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
 *     pnpm exec tsx scripts/migrate-people.ts --user <user-id> [--dry-run] [--force]
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
  contentBodySchema,
  contentSlugSchema,
  personMetadataSchema,
} from "@percy-main/shared/content";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createContentImageStore,
  type ContentImageStore,
} from "../src/lib/s3-content-images.ts";
import {
  convertBody,
  ensureImages,
  planImageUploads,
  prepareAsset,
  type PendingImage,
} from "./image-pipeline.ts";
import { blocksEqualIgnoringIds } from "./markdown-to-blocks.ts";
import { jsonEqual, parsePersonSource } from "./mdx-to-blocks.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE_DIR = path.resolve(__dirname, "../../web/content/people");

function parseArgs() {
  const args = process.argv.slice(2);
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  if (!userId) {
    console.error(
      "Usage: tsx scripts/migrate-people.ts --user <user-id> [--dry-run] [--force]",
    );
    process.exit(1);
  }
  return { userId, dryRun, force };
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

  const files = (await fs.readdir(PEOPLE_DIR))
    .filter((f) => f.endsWith(".mdx"))
    .sort();
  console.log(`Found ${String(files.length)} people in ${PEOPLE_DIR}`);

  const counts = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };
  let imagesUploaded = 0;
  let imagesReused = 0;
  const imageCache = new Map<string, PendingImage>();
  // Dry-run only: ids already reported as "would upload", so an asset
  // shared by two profiles is not double-counted.
  const plannedUploads = new Set<string>();

  // ONE shared go-live instant for everything inserted this run - people
  // profiles have no meaningful per-item publication date.
  const publishedAt = new Date();

  const failures: { file: string; reason: string }[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const migrated: { slug: string; action: string }[] = [];
  // Frontmatter slugs seen this run: the DB's (kind, slug) unique index
  // would catch a duplicate anyway, but a friendly per-file failure beats
  // a raw constraint violation mid-run.
  const seenSlugs = new Set<string>();

  const fail = (file: string, reason: string) => {
    counts.failed += 1;
    failures.push({ file, reason });
    console.warn(`  ! ${file}: ${reason}`);
  };

  for (const file of files) {
    // ── Parse + convert ───────────────────────────────────────────────
    interface Prepared {
      slug: string;
      title: string;
      metadata: Record<string, unknown>;
      blocks: ReturnType<typeof contentBodySchema.parse>;
      images: PendingImage[];
    }
    const prepared: Prepared | null = await (async () => {
      try {
        const source = await fs.readFile(path.join(PEOPLE_DIR, file), "utf8");
        const parsed = parsePersonSource(source);
        const slug = contentSlugSchema.parse(parsed.slug);
        if (seenSlugs.has(slug)) {
          throw new Error(`duplicate slug '${slug}' in the people corpus`);
        }
        seenSlugs.add(slug);
        const converted = await convertBody(parsed.body, imageCache);
        const images = [...converted.images];
        let photo: PendingImage | undefined;
        if (parsed.photo !== undefined) {
          // The photo's alt is always the person's name at render time,
          // so none is stored on the image row.
          photo = await prepareAsset(parsed.photo, null, imageCache);
          images.push(photo);
        }
        // The service validates metadata + body on every write; the
        // script writes directly, so it runs the same gates.
        const metadata = personMetadataSchema.parse({
          isDBSChecked: parsed.isDBSChecked,
          hasLeftClub: parsed.hasLeftClub,
          ...(photo !== undefined && { photo: photo.processed.picture }),
        });
        const blocks = contentBodySchema.parse(converted.blocks);
        return { slug, title: parsed.name, metadata, blocks, images };
      } catch (err) {
        fail(file, err instanceof Error ? err.message : String(err));
        return null;
      }
    })();
    if (prepared === null) continue;
    const { slug, title, metadata, blocks, images } = prepared;

    // ── Upsert ────────────────────────────────────────────────────────
    const existing = await db
      .selectFrom("content_item")
      .select(["id", "body", "title", "description", "metadata", "status"])
      .where("kind", "=", "person")
      .where("slug", "=", slug)
      .executeTakeFirst();

    if (existing) {
      // Same stance as the earlier migrations: a non-published row would
      // still 404 publicly, and a published row an editor may have
      // touched is only overwritten under --force (post-cutover the DB
      // is canonical and the MDX is the stale ancestor).
      if (existing.status !== "published") {
        counts.skipped += 1;
        const reason = `a ${existing.status} person already exists at '${slug}' - the public endpoint will 404. Publish or remove it, then re-run.`;
        skipped.push({ file, reason });
        console.warn(`  ! ${file}: ${reason}`);
        continue;
      }

      const unchanged =
        blocksEqualIgnoringIds(existing.body, blocks) &&
        existing.title === title &&
        existing.description === null &&
        jsonEqual(existing.metadata, metadata);
      if (unchanged) {
        counts.unchanged += 1;
        migrated.push({ slug, action: "unchanged" });
        console.log(`  = ${file} unchanged (${existing.title})`);
        continue;
      }
      if (!force) {
        counts.skipped += 1;
        const reason = `published profile '${existing.title}' differs from the MDX conversion (likely edited in the DB). Skipping - re-run with --force to overwrite.`;
        skipped.push({ file, reason });
        console.warn(`  ! ${file}: ${reason}`);
        continue;
      }

      if (dryRun) {
        const { newImages, reused } = await planImageUploads(
          db,
          images,
          plannedUploads,
        );
        imagesReused += reused;
        imagesUploaded += newImages.length;
        console.log(
          `  ~ ${file} would update '${title}' (${String(blocks.length)} blocks, ${String(images.length)} images)`,
        );
        for (const image of newImages) {
          console.log(`    ~ would upload ${image.publicPath}`);
        }
        counts.updated += 1;
        migrated.push({ slug, action: "updated" });
        continue;
      }

      if (!store) throw new Error("store unavailable outside a real run");
      const ensured = await ensureImages(db, store, userId, images);
      imagesUploaded += ensured.uploaded;
      imagesReused += ensured.reused;

      // slug/status/published_at untouched: rewriting published_at would
      // rewrite the profile's go-live history.
      await db.transaction().execute(async (tx) => {
        await tx
          .updateTable("content_item")
          .set({
            title,
            description: null,
            body: JSON.stringify(blocks),
            metadata: JSON.stringify(metadata),
            updated_by: userId,
            updated_at: new Date(),
          })
          .where("id", "=", existing.id)
          .execute();
        await tx
          .insertInto("content_revision")
          .values({
            content_id: existing.id,
            title,
            description: null,
            body: JSON.stringify(blocks),
            metadata: JSON.stringify(metadata),
            saved_by: userId,
          })
          .execute();
      });
      counts.updated += 1;
      migrated.push({ slug, action: "updated" });
      console.log(`  ^ ${file} updated (${title})`);
      continue;
    }

    // ── Insert ────────────────────────────────────────────────────────
    if (dryRun) {
      const { newImages, reused } = await planImageUploads(
        db,
        images,
        plannedUploads,
      );
      imagesReused += reused;
      imagesUploaded += newImages.length;
      console.log(
        `  ~ ${file} would insert '${title}' (${String(blocks.length)} blocks, ${String(images.length)} images, published_at ${publishedAt.toISOString()})`,
      );
      for (const image of newImages) {
        console.log(`    ~ would upload ${image.publicPath}`);
      }
      counts.inserted += 1;
      migrated.push({ slug, action: "inserted" });
      continue;
    }

    if (!store) throw new Error("store unavailable outside a real run");
    // Images first: like the editor flow, content_image rows + variants
    // exist before any item referencing them is saved.
    const ensured = await ensureImages(db, store, userId, images);
    imagesUploaded += ensured.uploaded;
    imagesReused += ensured.reused;

    await db.transaction().execute(async (tx) => {
      const inserted = await tx
        .insertInto("content_item")
        .values({
          kind: "person",
          slug,
          title,
          description: null,
          body: JSON.stringify(blocks),
          metadata: JSON.stringify(metadata),
          status: "published",
          published_at: publishedAt,
          created_by: userId,
          updated_by: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("content_revision")
        .values({
          content_id: inserted.id,
          title,
          description: null,
          body: JSON.stringify(blocks),
          metadata: JSON.stringify(metadata),
          saved_by: userId,
        })
        .execute();
    });
    counts.inserted += 1;
    migrated.push({ slug, action: "inserted" });
    console.log(`  + ${file} inserted as '${title}'`);
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("");
  console.log("=== Migration report ===");
  console.log(
    `People: ${String(counts.inserted)} inserted, ${String(counts.updated)} updated, ${String(counts.unchanged)} unchanged, ${String(counts.skipped)} skipped, ${String(counts.failed)} failed`,
  );
  console.log(
    `Images: ${String(imagesUploaded)} ${dryRun ? "would be uploaded" : "uploaded"}, ${String(imagesReused)} reused`,
  );

  console.log(`Migrated (${String(migrated.length)}):`);
  for (const item of migrated) {
    console.log(`  ${item.slug} (${item.action})`);
  }
  console.log(`Failed (${String(failures.length)}):`);
  for (const failure of failures) {
    console.log(`  ${failure.file}: ${failure.reason}`);
  }
  console.log(`Skipped (${String(skipped.length)}):`);
  for (const item of skipped) {
    console.log(`  ${item.file}: ${item.reason}`);
  }

  console.log(
    `Done with ${String(failures.length + skipped.length)} warnings${dryRun ? " (dry run)" : ""}`,
  );
  if (failures.length + skipped.length > 0) {
    // People have a per-slug fallback: a profile with no published DB row
    // keeps rendering from the static bundle (TRANSITION FALLBACK #489),
    // so a partial migration is safe - but the static MDX cleanup must
    // not remove files listed above.
    console.warn(
      "NOTE: failed/skipped profiles keep rendering from the static bundle " +
        "via the per-slug fallback. Do NOT delete their MDX in the " +
        "cleanup PR until they are resolved and re-run.",
    );
    process.exitCode = 2;
  }
  await db.destroy();
}

await main();
