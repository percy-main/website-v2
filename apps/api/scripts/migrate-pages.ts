/**
 * One-off migration (#496): import the legacy MDX content pages into the
 * content API's tables as published items, building parent_id/path from
 * the directory layout (dir/_index.mdx IS the parent item) and pushing
 * each embedded <Image> through the same processing pipeline as editor
 * uploads. pages/legal/** was initially excluded; #517 migrates it too
 * so the whole MDX pipeline can be removed.
 *
 * The script inserts rows directly (like migrate-news-events.ts), so it
 * upholds the page-hierarchy invariants itself rather than relying on
 * the content service: path = parent path + /slug, parents inserted
 * before children, and every page published with ONE shared
 * published_at (script start) so the child-go-live >= parent gate holds
 * trivially. A page that fails conversion stays static via the
 * TRANSITION FALLBACK (#489) - and because a child row cannot exist
 * without its parent row, a failed parent fails its whole subtree.
 *
 * Idempotent: upserts by page path. Unchanged items are skipped; image
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
 *     pnpm exec tsx scripts/migrate-pages.ts --user <user-id> [--dry-run] [--force]
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
  pageMetadataSchema,
  type ContentBody,
  type PageMetadata,
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
  type PendingImage,
} from "./image-pipeline.ts";
import { blocksEqualIgnoringIds } from "./markdown-to-blocks.ts";
import { jsonEqual, parsePageSource } from "./mdx-to-blocks.ts";
import {
  buildPageTree,
  parentFailureReason,
  type PageNode,
} from "./page-tree.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.resolve(__dirname, "../../web/content/pages");

function parseArgs() {
  const args = process.argv.slice(2);
  const userFlag = args.indexOf("--user");
  const userId = userFlag >= 0 ? args[userFlag + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  if (!userId) {
    console.error(
      "Usage: tsx scripts/migrate-pages.ts --user <user-id> [--dry-run] [--force]",
    );
    process.exit(1);
  }
  return { userId, dryRun, force };
}

interface NavEntry {
  path: string;
  title: string;
  menuOrder: number;
  isMainMenu: boolean;
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

  const files = (await fs.readdir(PAGES_DIR, { recursive: true }))
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.split(path.sep).join("/"))
    .sort();
  console.log(`Found ${String(files.length)} pages in ${PAGES_DIR}`);

  const tree = buildPageTree(files);

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
  // shared by two pages is not double-counted.
  const plannedUploads = new Set<string>();

  // ONE shared go-live instant for everything inserted this run: with
  // parents inserted first, child published_at == parent published_at
  // satisfies the child-go-live >= parent invariant trivially.
  const publishedAt = new Date();

  const failures: { file: string; reason: string }[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const migrated: { path: string; action: string }[] = [];
  const nav: NavEntry[] = [];

  // Paths whose page failed this run - parentFailureReason() consults
  // this to fail descendants (path order guarantees parents first).
  const failedPaths = new Set<string>();
  // Published parents available to attach children to: rows that exist
  // (or, dry-run, would exist) as status=published after this run.
  const publishedParents = new Map<
    string,
    { id: string | null; publishedAt: Date }
  >();

  const fail = (file: string, pagePath: string | undefined, reason: string) => {
    counts.failed += 1;
    failures.push({ file, reason });
    if (pagePath !== undefined) failedPaths.add(pagePath);
    console.warn(`  ! ${file}: ${reason}`);
  };

  for (const failure of tree.failed) {
    fail(failure.file, failure.path, failure.reason);
  }

  const processNode = async (node: PageNode) => {
    // ── Parent gates ──────────────────────────────────────────────────
    const parentFailed = parentFailureReason(node, failedPaths);
    if (parentFailed !== null) {
      fail(node.file, node.path, parentFailed);
      return;
    }
    let parentInfo: { id: string | null; publishedAt: Date } | null = null;
    if (node.parentPath !== null) {
      parentInfo = publishedParents.get(node.parentPath) ?? null;
      if (!parentInfo) {
        // The parent file processed without failing but did not yield a
        // published row (an existing draft/archived row sits at its
        // path) - a published child under it would break the hierarchy
        // invariant.
        fail(
          node.file,
          node.path,
          `parent page at ${node.parentPath} is not published - resolve it and re-run`,
        );
        return;
      }
      // An existing parent scheduled for the future would put this
      // child live before it - the exact invariant publishContent
      // enforces top-down.
      if (parentInfo.publishedAt.getTime() > publishedAt.getTime()) {
        fail(
          node.file,
          node.path,
          `parent page at ${node.parentPath} goes live in the future (${parentInfo.publishedAt.toISOString()}) - a child cannot publish before its parent`,
        );
        return;
      }
    }

    // ── Parse + convert ───────────────────────────────────────────────
    interface Prepared {
      title: string;
      description: string | null;
      metadata: PageMetadata;
      blocks: ContentBody;
      images: PendingImage[];
    }
    const prepared: Prepared | null = await (async () => {
      try {
        const source = await fs.readFile(
          path.join(PAGES_DIR, node.file),
          "utf8",
        );
        const parsed = parsePageSource(source);
        const metadata = pageMetadataSchema.parse({
          menuOrder: parsed.menuOrder,
          isMainMenu: parsed.isMainMenu,
          hideTitle: parsed.hideTitle,
          ...(parsed.ldjson !== undefined && { ldjson: parsed.ldjson }),
        });
        const converted = await convertBody(parsed.body, imageCache);
        // The service validates bodies on every write; the script writes
        // directly, so it runs the same gate.
        const blocks = contentBodySchema.parse(converted.blocks);
        return {
          title: parsed.title,
          description: parsed.description ?? null,
          metadata,
          blocks,
          images: converted.images,
        };
      } catch (err) {
        fail(
          node.file,
          node.path,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }
    })();
    if (prepared === null) return;
    const { title, description, metadata, blocks, images } = prepared;

    const navEntry: NavEntry = {
      path: node.path,
      title,
      menuOrder: metadata.menuOrder,
      isMainMenu: metadata.isMainMenu,
    };

    // ── Upsert ────────────────────────────────────────────────────────
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
      .where("kind", "=", "page")
      .where("path", "=", node.path)
      .executeTakeFirst();

    if (existing) {
      // Same stance as the news migration: a non-published row would
      // still 404 publicly, and a published row an editor may have
      // touched is only overwritten under --force (post-cutover the DB
      // is canonical and the MDX is the stale ancestor).
      if (existing.status !== "published" || existing.published_at === null) {
        counts.skipped += 1;
        const reason = `a ${existing.status} item already exists at ${node.path} - the public endpoint will 404. Publish or remove it, then re-run.`;
        skipped.push({ file: node.file, reason });
        console.warn(`  ! ${node.file}: ${reason}`);
        // Not added to failedPaths: descendants report the more precise
        // "parent not published" via the publishedParents miss.
        return;
      }

      // This path stays published whatever happens below, so children
      // may attach to it; its real published_at drives their gate.
      publishedParents.set(node.path, {
        id: existing.id,
        publishedAt: existing.published_at,
      });

      // published_at deliberately ignored: it is "script start" on
      // every run, while the row keeps its original go-live.
      const unchanged =
        blocksEqualIgnoringIds(existing.body, blocks) &&
        existing.title === title &&
        existing.description === description &&
        jsonEqual(existing.metadata, metadata);
      if (unchanged) {
        counts.unchanged += 1;
        migrated.push({ path: node.path, action: "unchanged" });
        nav.push(navEntry);
        console.log(`  = ${node.file} unchanged (${existing.title})`);
        return;
      }
      if (!force) {
        counts.skipped += 1;
        const reason = `published page '${existing.title}' differs from the MDX conversion (likely edited in the DB). Skipping - re-run with --force to overwrite.`;
        skipped.push({ file: node.file, reason });
        console.warn(`  ! ${node.file}: ${reason}`);
        // The page is still live with the DB's values - those are what
        // the nav actually serves.
        const dbMetadata = pageMetadataSchema.safeParse(existing.metadata);
        const effective = dbMetadata.success
          ? dbMetadata.data
          : pageMetadataSchema.parse({});
        nav.push({
          path: node.path,
          title: existing.title,
          menuOrder: effective.menuOrder,
          isMainMenu: effective.isMainMenu,
        });
        return;
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
          `  ~ ${node.file} would update '${title}' at ${node.path} (${String(blocks.length)} blocks, ${String(images.length)} images)`,
        );
        for (const image of newImages) {
          console.log(`    ~ would upload ${image.publicPath}`);
        }
        counts.updated += 1;
        migrated.push({ path: node.path, action: "updated" });
        nav.push(navEntry);
        return;
      }

      if (!store) throw new Error("store unavailable outside a real run");
      const ensured = await ensureImages(db, store, userId, images);
      imagesUploaded += ensured.uploaded;
      imagesReused += ensured.reused;

      // slug/parent_id/path/status/published_at untouched: the path
      // matched, so the hierarchy is already right, and rewriting
      // published_at would rewrite the page's go-live history.
      await db.transaction().execute(async (tx) => {
        await tx
          .updateTable("content_item")
          .set({
            title,
            description,
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
            description,
            body: JSON.stringify(blocks),
            metadata: JSON.stringify(metadata),
            saved_by: userId,
          })
          .execute();
      });
      counts.updated += 1;
      migrated.push({ path: node.path, action: "updated" });
      nav.push(navEntry);
      console.log(`  ^ ${node.file} updated (${title})`);
      return;
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
        `  ~ ${node.file} would insert '${title}' at ${node.path} (${String(blocks.length)} blocks, ${String(images.length)} images, published_at ${publishedAt.toISOString()})`,
      );
      for (const image of newImages) {
        console.log(`    ~ would upload ${image.publicPath}`);
      }
      counts.inserted += 1;
      migrated.push({ path: node.path, action: "inserted" });
      nav.push(navEntry);
      publishedParents.set(node.path, { id: null, publishedAt });
      return;
    }

    if (
      node.parentPath !== null &&
      (parentInfo === null || parentInfo.id === null)
    ) {
      // Real runs record real ids for every published parent; a miss
      // here is a bug, not a data condition.
      throw new Error(`no parent id recorded for ${node.parentPath}`);
    }

    if (!store) throw new Error("store unavailable outside a real run");
    // Images first: like the editor flow, content_image rows + variants
    // exist before any body referencing them is saved. Deferred to this
    // point so skipped pages write nothing at all.
    const ensured = await ensureImages(db, store, userId, images);
    imagesUploaded += ensured.uploaded;
    imagesReused += ensured.reused;

    await db.transaction().execute(async (tx) => {
      const inserted = await tx
        .insertInto("content_item")
        .values({
          kind: "page",
          slug: node.slug,
          parent_id: parentInfo?.id ?? null,
          path: node.path,
          title,
          description,
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
          description,
          body: JSON.stringify(blocks),
          metadata: JSON.stringify(metadata),
          saved_by: userId,
        })
        .execute();
      publishedParents.set(node.path, { id: inserted.id, publishedAt });
    });
    counts.inserted += 1;
    migrated.push({ path: node.path, action: "inserted" });
    nav.push(navEntry);
    console.log(`  + ${node.file} inserted as '${title}' at ${node.path}`);
  };

  for (const node of tree.ordered) {
    await processNode(node);
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("");
  console.log("=== Migration report ===");
  console.log(
    `Pages: ${String(counts.inserted)} inserted, ${String(counts.updated)} updated, ${String(counts.unchanged)} unchanged, ${String(counts.skipped)} skipped, ${String(counts.failed)} failed`,
  );
  console.log(
    `Images: ${String(imagesUploaded)} ${dryRun ? "would be uploaded" : "uploaded"}, ${String(imagesReused)} reused`,
  );

  console.log(`Migrated (${String(migrated.length)}):`);
  for (const item of migrated) {
    console.log(`  ${item.path} (${item.action})`);
  }
  console.log(`Failed (${String(failures.length)}):`);
  for (const failure of failures) {
    console.log(`  ${failure.file}: ${failure.reason}`);
  }
  console.log(`Skipped (${String(skipped.length)}):`);
  for (const item of skipped) {
    console.log(`  ${item.file}: ${item.reason}`);
  }

  // The before/after nav snapshot artifact: what getPublishedNav would
  // serve for this corpus after the run, in its path ordering. Compare
  // against the static staticNavPages projection.
  nav.sort((a, b) => a.path.localeCompare(b.path));
  console.log("Nav payload (path-sorted):");
  console.log(JSON.stringify(nav, null, 2));

  console.log(
    `Done with ${String(failures.length + skipped.length)} warnings${dryRun ? " (dry run)" : ""}`,
  );
  if (failures.length + skipped.length > 0) {
    // Unlike news/events, pages have a per-path fallback: a page with no
    // published DB row keeps rendering from the static bundle
    // (TRANSITION FALLBACK #489), so a partial migration is safe - but
    // the static MDX cleanup must not remove files listed above.
    console.warn(
      "NOTE: failed/skipped pages keep rendering from the static bundle " +
        "via the per-path fallback. Do NOT delete their MDX in the " +
        "cleanup PR until they are resolved and re-run.",
    );
    process.exitCode = 2;
  }
  await db.destroy();
}

await main();
