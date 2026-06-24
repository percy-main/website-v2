import type { DB } from "@percy-main/db";
import {
  CONTENT_METADATA_SCHEMAS,
  contentBodySchema,
  contentPathSchema,
  eventMetadataSchema,
  newsMetadataSchema,
  pageMetadataSchema,
  personMetadataSchema,
  RESERVED_ROOT_SLUGS,
  type ContentKind,
  type ContentStatus,
} from "@percy-main/shared/content";
import { sql, type Kysely, type Transaction } from "kysely";
import type { z } from "zod";
import type {
  createContentSchema,
  listContentQuerySchema,
  listNewsQuerySchema,
  updateContentSchema,
} from "./schemas.ts";

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

/**
 * Validate kind-specific metadata against the shared schema map. Every
 * kind has a schema as of Phase 4; the missing-schema guard stays as a
 * backstop so a future kind added to CONTENT_KINDS without one fails
 * closed instead of accepting arbitrary metadata.
 */
function parseMetadata(kind: ContentKind, metadata: Record<string, unknown>) {
  const schema = CONTENT_METADATA_SCHEMAS[kind];
  if (!schema) {
    throwHttpError(400, `Content kind '${kind}' is not editable yet`);
  }
  const result = schema.safeParse(metadata);
  if (!result.success) {
    throwHttpError(
      400,
      `Invalid metadata for kind '${kind}': ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/** Validate the body is a structurally sound BlockNote block array. */
function parseBody(body: unknown) {
  const result = contentBodySchema.safeParse(body);
  if (!result.success) {
    throwHttpError(400, "Body is not a valid block document");
  }
  return result.data;
}

/**
 * The public game-report lookup is by playCricketId, so it must be unique
 * across game reports regardless of status (a draft duplicate would make
 * the lookup nondeterministic the moment it published). A unique
 * expression index backs this; the explicit check exists for a friendly
 * 409 instead of a raw constraint violation.
 */
async function assertPlayCricketIdAvailable(
  tx: Transaction<DB>,
  kind: ContentKind,
  metadata: Record<string, unknown>,
  excludeId?: string,
) {
  if (kind !== "game_report") return;
  const playCricketId = metadata.playCricketId;
  if (typeof playCricketId !== "string") return;

  let query = tx
    .selectFrom("content_item")
    .select("id")
    .where("kind", "=", "game_report")
    .where(sql<string>`metadata->>'playCricketId'`, "=", playCricketId);
  if (excludeId !== undefined) {
    query = query.where("id", "!=", excludeId);
  }
  const clash = await query.executeTakeFirst();
  if (clash) {
    throwHttpError(
      409,
      `A game report for Play-Cricket match ${playCricketId} already exists`,
    );
  }
}

interface ContentItemRow {
  id: string;
  kind: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  metadata: unknown;
  parent_id: string | null;
  path: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
  updated_by_name: string | null;
}

/**
 * menuOrder hoisted out of a page's metadata for the admin tree view
 * (null for every other kind). Falls back to the schema default rather
 * than failing the whole list if a stored row somehow predates the page
 * metadata schema.
 */
function pageMenuOrder(kind: string, metadata: unknown): number | null {
  if (kind !== "page") return null;
  const parsed = pageMetadataSchema.safeParse(metadata);
  return parsed.success
    ? parsed.data.menuOrder
    : pageMetadataSchema.parse({}).menuOrder;
}

function toSummary(row: ContentItemRow) {
  return {
    id: row.id,
    kind: row.kind as ContentKind,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status as ContentStatus,
    metadata: row.metadata as Record<string, unknown>,
    parentId: row.parent_id,
    path: row.path,
    menuOrder: pageMenuOrder(row.kind, row.metadata),
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
  };
}

const summaryColumns = [
  "content_item.id",
  "content_item.kind",
  "content_item.slug",
  "content_item.title",
  "content_item.description",
  "content_item.status",
  "content_item.metadata",
  "content_item.parent_id",
  "content_item.path",
  "content_item.published_at",
  "content_item.created_at",
  "content_item.updated_at",
  "content_item.updated_by",
] as const;

function selectSummary(db: Kysely<DB>) {
  return db
    .selectFrom("content_item")
    .leftJoin("user as updater", "updater.id", "content_item.updated_by")
    .select([...summaryColumns, "updater.name as updated_by_name"]);
}

/**
 * Snapshot the item's editorial fields into content_revision. Exported so
 * the profile self-edit approval path (#575) writes history through the
 * same helper - an approved proposal is just another save.
 */
export async function writeRevision(
  tx: Transaction<DB>,
  item: {
    id: string;
    title: string;
    description: string | null;
    body: unknown;
    metadata: unknown;
  },
  savedBy: string,
) {
  await tx
    .insertInto("content_revision")
    .values({
      content_id: item.id,
      title: item.title,
      description: item.description,
      body: JSON.stringify(item.body),
      metadata: JSON.stringify(item.metadata),
      saved_by: savedBy,
    })
    .execute();
}

// ── Admin: list ─────────────────────────────────────────────────────────

export function listContent(db: Kysely<DB>) {
  return async (params: z.infer<typeof listContentQuerySchema>) => {
    let base = db.selectFrom("content_item").where("kind", "=", params.kind);
    if (params.status !== undefined) {
      base = base.where("status", "=", params.status);
    }
    if (params.search !== undefined) {
      // Escape ILIKE wildcards: search box input is a literal, not a pattern.
      const literal = params.search.replace(/[\\%_]/g, "\\$&");
      base = base.where("title", "ilike", `%${literal}%`);
    }

    const [items, totalRow] = await Promise.all([
      base
        .leftJoin("user as updater", "updater.id", "content_item.updated_by")
        .select([...summaryColumns, "updater.name as updated_by_name"])
        .orderBy("content_item.updated_at", "desc")
        .limit(params.pageSize)
        .offset((params.page - 1) * params.pageSize)
        .execute(),
      base.select(sql<string>`COUNT(*)`.as("total")).executeTakeFirstOrThrow(),
    ]);

    return {
      items: items.map(toSummary),
      total: Number(totalRow.total),
    };
  };
}

// ── Admin: page tree ────────────────────────────────────────────────────

export function listPageTree(db: Kysely<DB>) {
  return async () => {
    // Every page regardless of status (the corpus is ~dozens of rows),
    // ordered by path so ancestors precede their descendants and the
    // order is stable; the client assembles the tree from parentId.
    const rows = await db
      .selectFrom("content_item")
      .select([
        "id",
        "title",
        "slug",
        "path",
        "parent_id",
        "metadata",
        "status",
        "published_at",
        "updated_at",
      ])
      .where("kind", "=", "page")
      .orderBy("path", "asc")
      .execute();

    return {
      items: rows.map((row) => {
        if (row.path === null) {
          // Set at create for every page (see the hierarchy helpers), so
          // a NULL here is a data problem, not a normal state.
          throwHttpError(500, "Page is missing its path");
        }
        // Parsing applies the schema defaults (menuOrder 99, flags
        // false); a malformed stored row degrades to pure defaults
        // rather than failing the whole tree (same stance as
        // pageMenuOrder above).
        const parsed = pageMetadataSchema.safeParse(row.metadata);
        const metadata = parsed.success
          ? parsed.data
          : pageMetadataSchema.parse({});
        return {
          id: row.id,
          title: row.title,
          slug: row.slug,
          path: row.path,
          parentId: row.parent_id,
          menuOrder: metadata.menuOrder,
          isMainMenu: metadata.isMainMenu,
          status: row.status as ContentStatus,
          publishedAt: row.published_at?.toISOString() ?? null,
          updatedAt: row.updated_at.toISOString(),
          // The ever-published marker IS the slug/parent lock
          // updateContent enforces; derived server-side so the UI never
          // re-implements lock semantics.
          pathLocked: row.published_at !== null,
        };
      }),
    };
  };
}

// ── Admin: get ──────────────────────────────────────────────────────────

export function getContent(db: Kysely<DB>) {
  return async (contentId: string) => {
    const row = await selectSummary(db)
      .select("content_item.body")
      .where("content_item.id", "=", contentId)
      .executeTakeFirst();

    if (!row) throwHttpError(404, "Content not found");

    // A stored body failing the schema is a server-side data problem, not
    // a bad request - parseBody's 400 is for write paths.
    const body = contentBodySchema.safeParse(row.body);
    if (!body.success) {
      throwHttpError(500, "Stored body does not match the block schema");
    }
    return { ...toSummary(row), body: body.data };
  };
}

/**
 * Kind + status lookup used by routes: kind resolves the permission
 * resource, status decides whether editing needs the publish action
 * (changing a published item changes the live page).
 */
export function getContentMeta(db: Kysely<DB>) {
  return async (contentId: string) => {
    const row = await db
      .selectFrom("content_item")
      .select(["kind", "status"])
      .where("id", "=", contentId)
      .executeTakeFirst();
    if (!row) throwHttpError(404, "Content not found");
    return {
      kind: row.kind as ContentKind,
      status: row.status as ContentStatus,
    };
  };
}

// ── Hierarchy helpers (pages only) ──────────────────────────────────────
//
// Pages form an adjacency list via parent_id with a materialised URL
// path; every other kind keeps both NULL. A page's path is computed on
// every create and on slug/parent changes (never client-supplied), so a
// path is canonical by construction: descendants of a page are exactly
// the rows whose path extends its own.

/**
 * Serialise every page-tree mutation on one transaction-scoped advisory
 * lock (released automatically at commit/rollback).
 *
 * The tree invariants - no parent_id cycles, materialised path = parent
 * path + slug for every descendant, publish ordering, the
 * ever-published lock - span MULTIPLE rows, so the per-row FOR UPDATE
 * locks cannot exclude write-skew: two concurrent moves (A under B, B
 * under A) each pass their cycle check and commit a cycle; a
 * create-under-parent racing an ancestor rename lands with a stale path
 * prefix the rename's cascade never saw; a slug change racing a publish
 * bypasses the ever-published lock. Taking this lock first makes every
 * page mutation fully serial. The page corpus is ~30 rows with a
 * handful of edits a day, so the serialisation cost is irrelevant. The
 * FOR UPDATE row locks stay as belt-and-braces (and for the non-page
 * flows that share these code paths).
 */
async function lockPageTree(tx: Transaction<DB>) {
  await tx
    .selectNoFrom(
      sql`pg_advisory_xact_lock(hashtext('content-page-tree'))`.as(
        "page_tree_lock",
      ),
    )
    .execute();
}

/**
 * Computed paths (on create and for every cascaded descendant on
 * rename/move) must stay within contentPathSchema's bounds - the same
 * rule the pages migration enforces - or the public by-path lookup
 * (whose querystring is validated by that schema) could never reach
 * the page.
 */
function assertValidPath(path: string) {
  if (!contentPathSchema.safeParse(path).success) {
    throwHttpError(
      400,
      `The resulting page path '${path}' is too long or too deep - use a shorter slug or move the page higher up the tree`,
    );
  }
}

/**
 * A ROOT page may not occupy a slug the SPA router or infra owns (only
 * the first path segment routes, so children are unaffected).
 */
function assertRootSlugAllowed(slug: string) {
  if (RESERVED_ROOT_SLUGS.has(slug)) {
    throwHttpError(400, "This address is reserved by the site");
  }
}

/**
 * Resolve a prospective parent: must exist, be a page, and not be
 * archived (an archived page is a retired URL prefix - nothing new
 * grows under it; the publish gate would block the child anyway, so
 * fail at authoring time with a message that says why). Returns its
 * path (set at create for every page, so non-null - a NULL here means
 * the row predates hierarchy support, which cannot happen: pages were
 * not editable through the API before it).
 */
async function resolveParentPage(
  tx: Transaction<DB>,
  parentId: string,
  archivedMessage: string,
) {
  const parent = await tx
    .selectFrom("content_item")
    .select(["id", "kind", "path", "status"])
    .where("id", "=", parentId)
    .executeTakeFirst();
  if (parent?.kind !== "page") {
    throwHttpError(400, "Parent page not found");
  }
  if (parent.status === "archived") {
    throwHttpError(400, archivedMessage);
  }
  if (parent.path === null) {
    throwHttpError(500, "Parent page is missing its path");
  }
  return { id: parent.id, path: parent.path };
}

/**
 * Friendly 409 for a slug clash among siblings (root pages and flat
 * kinds: per-kind among parentless rows; child pages: among the
 * parent's children). The partial unique indexes are the backstop.
 */
async function assertSlugAvailable(
  tx: Transaction<DB>,
  kind: ContentKind,
  slug: string,
  parentId: string | null,
  excludeId?: string,
) {
  let query = tx
    .selectFrom("content_item")
    .select("id")
    .where("kind", "=", kind)
    .where("slug", "=", slug);
  query =
    parentId === null
      ? query.where("parent_id", "is", null)
      : query.where("parent_id", "=", parentId);
  if (excludeId !== undefined) {
    query = query.where("id", "!=", excludeId);
  }
  const clash = await query.executeTakeFirst();
  if (clash) {
    throwHttpError(409, `A ${kind} item with slug '${slug}' already exists`);
  }
}

// ── Admin: create ───────────────────────────────────────────────────────

export function createContent(db: Kysely<DB>) {
  return async (
    params: z.infer<typeof createContentSchema> & { userId: string },
  ) => {
    const metadata = parseMetadata(params.kind, params.metadata);
    const body = parseBody(params.body);
    const description = params.description ?? null;
    const parentId = params.parentId ?? null;

    if (parentId !== null && params.kind !== "page") {
      throwHttpError(400, "Only pages can have a parent page");
    }
    if (params.kind === "page" && parentId === null) {
      assertRootSlugAllowed(params.slug);
    }

    return await db.transaction().execute(async (tx) => {
      // Page creates mutate the tree (their path embeds the parent
      // chain), so they serialise on the advisory lock before any read.
      if (params.kind === "page") {
        await lockPageTree(tx);
      }

      let path: string | null = null;
      if (params.kind === "page") {
        if (parentId !== null) {
          const parent = await resolveParentPage(
            tx,
            parentId,
            "Cannot create a page under an archived page",
          );
          path = `${parent.path}/${params.slug}`;
        } else {
          path = `/${params.slug}`;
        }
        assertValidPath(path);
      }

      // Sibling-slug uniqueness implies path uniqueness too (a path is
      // parent path + slug, and parent paths are unique), so this is the
      // friendly 409 for both; the unique indexes catch races.
      await assertSlugAvailable(tx, params.kind, params.slug, parentId);

      await assertPlayCricketIdAvailable(tx, params.kind, metadata);

      const item = await tx
        .insertInto("content_item")
        .values({
          kind: params.kind,
          slug: params.slug,
          parent_id: parentId,
          path,
          title: params.title,
          description,
          body: JSON.stringify(body),
          metadata: JSON.stringify(metadata),
          status: "draft",
          created_by: params.userId,
          updated_by: params.userId,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      await writeRevision(
        tx,
        {
          id: item.id,
          title: params.title,
          description,
          body,
          metadata,
        },
        params.userId,
      );

      return { id: item.id };
    });
  };
}

// ── Admin: update ───────────────────────────────────────────────────────

export function updateContent(db: Kysely<DB>) {
  return async (
    params: z.infer<typeof updateContentSchema> & {
      contentId: string;
      userId: string;
    },
  ) => {
    return await db.transaction().execute(async (tx) => {
      // Slug/parent changes mutate the page tree (path recompute +
      // descendant cascade), so they serialise on the advisory lock
      // BEFORE any read - every check below (including the
      // ever-published lock on published_at) then runs on post-lock
      // state, closing the change-vs-publish race. Taken whenever the
      // params are present: the kind isn't known until the row is read,
      // and over-locking a non-page slug change is harmless.
      if (params.slug !== undefined || params.parentId !== undefined) {
        await lockPageTree(tx);
      }

      const current = await tx
        .selectFrom("content_item")
        .select([
          "id",
          "kind",
          "slug",
          "parent_id",
          "path",
          "title",
          "description",
          "body",
          "metadata",
          "published_at",
        ])
        .where("id", "=", params.contentId)
        .executeTakeFirst();

      if (!current) throwHttpError(404, "Content not found");

      const kind = current.kind as ContentKind;
      const isPage = kind === "page";

      if (!isPage && params.parentId != null) {
        throwHttpError(400, "Only pages can have a parent page");
      }

      const slug = params.slug ?? current.slug;
      const slugChanged = slug !== current.slug;
      // undefined = unchanged, null = move to root, id = move under it.
      const parentId =
        params.parentId !== undefined ? params.parentId : current.parent_id;
      const parentChanged = parentId !== current.parent_id;

      // The slug - and for pages the parent too, since path = parent path
      // + slug - locks once the item has ever been publicly visible.
      // published_at is the ever-published marker: unpublish keeps it for
      // items that went live, and clears it when cancelling a schedule
      // that never did - which re-unlocks the slug, deliberately. No
      // redirect handling exists anywhere.
      if ((slugChanged || parentChanged) && current.published_at !== null) {
        throwHttpError(
          409,
          isPage
            ? "Slug and parent are locked once a page has been published - its path is its public URL"
            : "Slug is locked once an item has been published",
        );
      }

      const title = params.title ?? current.title;
      const description =
        params.description !== undefined
          ? params.description
          : current.description;
      const body =
        params.body !== undefined
          ? parseBody(params.body)
          : parseBody(current.body);
      const metadata =
        params.metadata !== undefined
          ? parseMetadata(kind, params.metadata)
          : parseMetadata(kind, current.metadata as Record<string, unknown>);

      // Pages: a slug or parent change recomputes this page's path and
      // every descendant's. Descendants are exactly the rows whose path
      // extends this page's (paths are materialised from the parent
      // chain, so the prefix relation is canonical).
      let path = current.path;
      let cascade: {
        ids: string[];
        newPrefix: string;
        oldPrefixLength: number;
      } | null = null;

      if (isPage && (slugChanged || parentChanged)) {
        const oldPath = current.path;
        if (oldPath === null) {
          throwHttpError(500, "Page is missing its path");
        }

        const descendants = await tx
          .selectFrom("content_item")
          .select(["id", "path", "published_at"])
          .where("path", "like", `${oldPath}/%`)
          .execute();

        // An ever-published descendant's URL is (or was) live, which pins
        // every ancestor slug on its path - same lock as its own.
        const locked = descendants.find((d) => d.published_at !== null);
        if (locked) {
          throwHttpError(
            409,
            `Cannot change this page's slug or parent: descendant page '${locked.path ?? locked.id}' has been published, which pins its ancestors' slugs`,
          );
        }

        let newPath: string;
        if (parentId === null) {
          assertRootSlugAllowed(slug);
          newPath = `/${slug}`;
        } else {
          if (parentId === current.id) {
            throwHttpError(400, "A page cannot be its own parent");
          }
          const parent = await resolveParentPage(
            tx,
            parentId,
            "Cannot move a page under an archived page",
          );
          if (parent.path.startsWith(`${oldPath}/`)) {
            throwHttpError(
              400,
              "A page cannot be moved under one of its own descendants",
            );
          }
          newPath = `${parent.path}/${slug}`;
        }
        // The new path AND every cascaded descendant path must stay
        // within contentPathSchema's bounds (a move deeper can push a
        // deep subtree over the limit even when this page's own path
        // is fine).
        assertValidPath(newPath);
        for (const d of descendants) {
          if (d.path !== null) {
            assertValidPath(newPath + d.path.slice(oldPath.length));
          }
        }
        path = newPath;

        if (descendants.length > 0) {
          cascade = {
            ids: descendants.map((d) => d.id),
            newPrefix: newPath,
            oldPrefixLength: oldPath.length,
          };
        }
      }

      if (slugChanged || parentChanged) {
        await assertSlugAvailable(
          tx,
          kind,
          slug,
          isPage ? parentId : null,
          current.id,
        );
      }

      if (params.metadata !== undefined) {
        await assertPlayCricketIdAvailable(tx, kind, metadata, current.id);
      }

      // parent_id/path are only written when the hierarchy actually
      // changed: writing back the values read at the top would clobber
      // a concurrent ancestor-rename cascade (which bumps this row's
      // path) from an unrelated edit. Hierarchy changes themselves are
      // serialised by the advisory lock above.
      const hierarchyChanged = isPage && (slugChanged || parentChanged);
      await tx
        .updateTable("content_item")
        .set({
          slug,
          ...(hierarchyChanged ? { parent_id: parentId, path } : {}),
          title,
          description,
          body: JSON.stringify(body),
          metadata: JSON.stringify(metadata),
          updated_by: params.userId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where("id", "=", current.id)
        .execute();

      if (cascade !== null) {
        // Re-prefix every descendant path in one statement. Paths only
        // contain [a-z0-9-/], so the LIKE above and the substr here need
        // no escaping. Bump updated_at/updated_by: the row's public URL
        // changed, and admin list ordering + ETags key off updated_at.
        await tx
          .updateTable("content_item")
          .set({
            path: sql`${cascade.newPrefix} || substr(path, ${sql.lit(cascade.oldPrefixLength + 1)})`,
            updated_by: params.userId,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where("id", "in", cascade.ids)
          .execute();
      }

      await writeRevision(
        tx,
        { id: current.id, title, description, body, metadata },
        params.userId,
      );

      return { id: current.id };
    });
  };
}

// ── Admin: status transitions ───────────────────────────────────────────

export function publishContent(db: Kysely<DB>) {
  return async (params: {
    contentId: string;
    publishedAt?: string;
    userId: string;
  }) => {
    // The hierarchy gates are check-then-update, so they run in a
    // transaction over FOR UPDATE row locks. Lock order is parent ->
    // child everywhere (unpublish/archive lock the item, then its
    // children), so the parent row must be locked before the item; the
    // unlocked peek only discovers which parent that is.
    return await db.transaction().execute(async (tx) => {
      const peek = await tx
        .selectFrom("content_item")
        .select(["kind", "parent_id"])
        .where("id", "=", params.contentId)
        .executeTakeFirst();
      if (!peek) throwHttpError(404, "Content not found");

      // Page status transitions participate in the tree invariants
      // (publish ordering vs slug/parent changes), so they serialise on
      // the same advisory lock as create/update. Taken before any row
      // lock; all gates below re-read under it.
      if (peek.kind === "page") {
        await lockPageTree(tx);
      }

      const lockParent = (parentId: string) =>
        tx
          .selectFrom("content_item")
          .select([
            "status",
            "published_at",
            // DB-clock liveness, consistent with publishedOnly().
            // NULL published_at propagates: live_now is then NULL too.
            sql<boolean | null>`published_at <= CURRENT_TIMESTAMP`.as(
              "live_now",
            ),
          ])
          .where("id", "=", parentId)
          .forUpdate()
          .executeTakeFirst();

      let parent =
        peek.kind === "page" && peek.parent_id !== null
          ? await lockParent(peek.parent_id)
          : undefined;

      const item = await tx
        .selectFrom("content_item")
        .select(["kind", "status", "parent_id"])
        .where("id", "=", params.contentId)
        .forUpdate()
        .executeTakeFirst();
      if (!item) throwHttpError(404, "Content not found");
      if (item.status === "archived") {
        throwHttpError(409, "Archived content cannot be published");
      }

      // A page goes live at parent path + slug, so a child must never be
      // publicly visible while its parent is not (dead URL prefix,
      // broken breadcrumbs/nav). Publish top-down...
      if (item.kind === "page" && item.parent_id !== null) {
        if (item.parent_id !== peek.parent_id) {
          // Reparented between the peek and the item lock: lock the
          // actual parent. Out of lock order, but the race is
          // vanishingly rare and PostgreSQL resolves any deadlock by
          // aborting one transaction.
          parent = await lockParent(item.parent_id);
        }
        if (parent?.status !== "published" || parent.published_at === null) {
          throwHttpError(
            400,
            "Cannot publish this page until its parent page is published",
          );
        }
        // ...and never ahead of the parent: the child's effective
        // go-live (the explicit date, or now) may not precede the
        // parent's published_at. Scheduling a whole section for one
        // instant stays allowed; backdating a child before its parent
        // is not.
        const beforeParent =
          params.publishedAt !== undefined
            ? new Date(params.publishedAt) < parent.published_at
            : parent.live_now !== true;
        if (beforeParent) {
          throwHttpError(
            400,
            `Parent page goes live at ${parent.published_at.toISOString()}; schedule this page for that time or later`,
          );
        }
      }

      // The mirror gate, parent's side: re-scheduling (or backdating)
      // this page's go-live must not strand an already-published child
      // whose go-live precedes it - between the two instants the child
      // would be publicly live under a 404ing parent. Direct children
      // suffice: the child gate above guarantees grandchildren never
      // precede their own parent. Only an explicit publishedAt can move
      // the go-live later (publish-now never produces a future date).
      // Equal instants stay allowed, matching the child gate.
      if (item.kind === "page" && params.publishedAt !== undefined) {
        const stranded = await tx
          .selectFrom("content_item")
          .select("id")
          .where("parent_id", "=", params.contentId)
          .where("status", "=", "published")
          .where("published_at", "<", new Date(params.publishedAt))
          .forUpdate()
          .executeTakeFirst();
        if (stranded) {
          throwHttpError(
            400,
            "Children are scheduled before this go-live - reschedule them first",
          );
        }
      }

      let query = tx
        .updateTable("content_item")
        .set({
          status: "published",
          // No explicit date: keep the original "live from" time only when
          // it is already in the past (re-publish after unpublish must not
          // rewrite history). NULL (first publish) or a still-future
          // schedule (the editor pressed "Publish now" on a scheduled
          // item) becomes now(). NULL <= now() is NULL, so both fall to
          // the ELSE branch. Expressed in SQL so the comparison uses the
          // DB clock, consistent with publishedOnly().
          published_at: params.publishedAt
            ? new Date(params.publishedAt)
            : sql`CASE
              WHEN published_at <= CURRENT_TIMESTAMP THEN published_at
              ELSE CURRENT_TIMESTAMP
            END`,
          updated_by: params.userId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where("id", "=", params.contentId)
        .where("status", "!=", "archived");

      if (params.publishedAt !== undefined) {
        // Invariant: published_at in the past <=> the item has been
        // publicly visible. An explicit FUTURE date on an item whose
        // published_at is already past would silently pull a page that WAS
        // public - and a later cancel-schedule would see a future
        // published_at, clear it, and unlock the slug of a page whose URL
        // was live. Guarded inside the UPDATE's WHERE on the DB clock so
        // it cannot race the publish boundary; the IS NOT NULL keeps a
        // first publish (NULL published_at) out of the NULL-propagating
        // comparison. Explicit past/current dates stay allowed (idempotent
        // re-publish, migration-style backdating).
        query = query.where(
          sql<boolean>`NOT (
          published_at IS NOT NULL
          AND published_at <= CURRENT_TIMESTAMP
          AND ${new Date(params.publishedAt)}::timestamptz > CURRENT_TIMESTAMP
        )`,
        );
      }

      const result = await query
        .returning(["id", "published_at"])
        .executeTakeFirst();

      if (!result) {
        // The item row is locked and passed the archived check, so the
        // only remaining exclusion is the ever-live scheduling guard.
        throwHttpError(
          409,
          "This item has already been live - it can only be published immediately",
        );
      }

      return {
        id: result.id,
        publishedAt: result.published_at?.toISOString() ?? null,
      };
    });
  };
}

export function unpublishContent(db: Kysely<DB>) {
  return async (params: { contentId: string; userId: string }) => {
    // Transaction + FOR UPDATE: the published-children gate must not
    // race a concurrent child publish. Lock order parent -> child (the
    // item IS the parent here), consistent with publishContent.
    return await db.transaction().execute(async (tx) => {
      // Unlocked peek for lock targeting only: page status transitions
      // serialise on the page-tree advisory lock, which must precede
      // every row lock. All gates re-read under the locks below.
      const peek = await tx
        .selectFrom("content_item")
        .select("kind")
        .where("id", "=", params.contentId)
        .executeTakeFirst();
      if (!peek) throwHttpError(404, "Content not found");
      if (peek.kind === "page") {
        await lockPageTree(tx);
      }

      const item = await tx
        .selectFrom("content_item")
        .select(["kind", "status"])
        .where("id", "=", params.contentId)
        .forUpdate()
        .executeTakeFirst();
      if (!item) throwHttpError(404, "Content not found");
      if (item.status !== "published") {
        // Only a published item can be unpublished - in particular this
        // must not offer a back door out of 'archived' (archive ->
        // unpublish -> publish would resurrect archived content past the
        // manage-only archive control).
        throwHttpError(409, "Only published content can be unpublished");
      }

      // Mirror of the publish rule: pulling a page out from under a
      // published (or scheduled) child would leave live URLs on a dead
      // prefix. Unpublish bottom-up. (A child publish locks this row
      // before its own, so holding it already serialises the gate; the
      // child lock makes the pattern uniform.)
      if (item.kind === "page") {
        const publishedChild = await tx
          .selectFrom("content_item")
          .select("id")
          .where("parent_id", "=", params.contentId)
          .where("status", "=", "published")
          .forUpdate()
          .executeTakeFirst();
        if (publishedChild) {
          throwHttpError(
            400,
            "Cannot unpublish a page that has published child pages - unpublish the children first",
          );
        }
      }

      // A past published_at is deliberately retained: it marks "ever
      // published", which locks the slug. A still-future published_at
      // means a schedule being cancelled before the public ever saw the
      // item, so the ever-published marker is cleared and the slug
      // unlocks. Visibility is otherwise governed by status alone.
      const result = await tx
        .updateTable("content_item")
        .set({
          status: "draft",
          published_at: sql`CASE
            WHEN published_at > CURRENT_TIMESTAMP THEN NULL
            ELSE published_at
          END`,
          updated_by: params.userId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where("id", "=", params.contentId)
        .where("status", "=", "published")
        .returning("id")
        .executeTakeFirst();

      if (!result) {
        throwHttpError(409, "Only published content can be unpublished");
      }
      return { id: result.id };
    });
  };
}

export function archiveContent(db: Kysely<DB>) {
  return async (params: { contentId: string; userId: string }) => {
    // Same transaction + lock pattern as unpublishContent: the
    // published-children gate must not race a concurrent child publish.
    return await db.transaction().execute(async (tx) => {
      // Unlocked peek for lock targeting only (see unpublishContent).
      const peek = await tx
        .selectFrom("content_item")
        .select("kind")
        .where("id", "=", params.contentId)
        .executeTakeFirst();
      if (!peek) throwHttpError(404, "Content not found");
      if (peek.kind === "page") {
        await lockPageTree(tx);
      }

      const item = await tx
        .selectFrom("content_item")
        .select(["kind", "status"])
        .where("id", "=", params.contentId)
        .forUpdate()
        .executeTakeFirst();
      if (!item) throwHttpError(404, "Content not found");
      if (item.status === "archived") {
        // Re-archiving must not silently succeed: it would bump
        // updated_at/updated_by for a no-op, misattributing the archive.
        throwHttpError(409, "Content is already archived");
      }

      // Archiving a page over a live child is the unpublish hole in a
      // different coat: the child's URL would sit on a dead prefix.
      // Direct children suffice - the publish gate guarantees a
      // published grandchild implies a published middle page. A DRAFT
      // child under an archived parent is fine; it just cannot publish
      // (parent-not-published gate).
      if (item.kind === "page") {
        const publishedChild = await tx
          .selectFrom("content_item")
          .select("id")
          .where("parent_id", "=", params.contentId)
          .where("status", "=", "published")
          .forUpdate()
          .executeTakeFirst();
        if (publishedChild) {
          throwHttpError(
            409,
            "Cannot archive a page that has published child pages - unpublish or archive the children first",
          );
        }
      }

      const result = await tx
        .updateTable("content_item")
        .set({
          status: "archived",
          updated_by: params.userId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where("id", "=", params.contentId)
        .where("status", "!=", "archived")
        .returning("id")
        .executeTakeFirst();

      if (!result) {
        throwHttpError(409, "Content is already archived");
      }
      return { id: result.id };
    });
  };
}

// ── Admin: revisions ────────────────────────────────────────────────────

export function listRevisions(db: Kysely<DB>) {
  return async (contentId: string) => {
    // 404 on unknown content id so a typo'd URL doesn't read as "no
    // revisions yet" (every item has at least its creation revision).
    const exists = await db
      .selectFrom("content_item")
      .select("id")
      .where("id", "=", contentId)
      .executeTakeFirst();
    if (!exists) throwHttpError(404, "Content not found");

    const rows = await db
      .selectFrom("content_revision")
      .leftJoin("user as saver", "saver.id", "content_revision.saved_by")
      .select([
        "content_revision.id",
        "content_revision.title",
        "content_revision.saved_at",
        "content_revision.saved_by",
        "saver.name as saved_by_name",
      ])
      .where("content_revision.content_id", "=", contentId)
      .orderBy("content_revision.saved_at", "desc")
      .execute();

    return {
      revisions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        savedAt: r.saved_at.toISOString(),
        savedBy: r.saved_by,
        savedByName: r.saved_by_name,
      })),
    };
  };
}

export function getRevision(db: Kysely<DB>) {
  return async (params: { contentId: string; revisionId: string }) => {
    // The content_id filter makes the lookup tenant-safe within the
    // route's permission model: the route gates on the CONTENT item's
    // kind, so a revision must never be reachable under a different
    // (more permissive) item's id.
    const row = await db
      .selectFrom("content_revision")
      .leftJoin("user as saver", "saver.id", "content_revision.saved_by")
      .select([
        "content_revision.id",
        "content_revision.title",
        "content_revision.description",
        "content_revision.body",
        "content_revision.metadata",
        "content_revision.saved_at",
        "content_revision.saved_by",
        "saver.name as saved_by_name",
      ])
      .where("content_revision.id", "=", params.revisionId)
      .where("content_revision.content_id", "=", params.contentId)
      .executeTakeFirst();
    if (!row) throwHttpError(404, "Revision not found");

    // A stored body failing the schema is a server-side data problem,
    // not a bad request - same stance as getContent.
    const parsedBody = contentBodySchema.safeParse(row.body);
    if (!parsedBody.success) {
      throwHttpError(500, "Stored body does not match the block schema");
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      body: parsedBody.data,
      metadata: row.metadata as Record<string, unknown>,
      savedAt: row.saved_at.toISOString(),
      savedBy: row.saved_by,
      savedByName: row.saved_by_name,
    };
  };
}

// ── Public reads ────────────────────────────────────────────────────────

function toPublic(row: {
  id: string;
  kind: string;
  slug: string;
  title: string;
  description: string | null;
  body: unknown;
  metadata: unknown;
  published_at: Date | null;
  updated_at: Date;
}) {
  // Non-null by check constraint when status='published'; guard anyway so
  // a future constraint change fails loudly instead of serving garbage.
  if (!row.published_at) {
    throwHttpError(500, "Published content missing published_at");
  }
  const kind = row.kind as ContentKind;
  // The metadata schema map doubles as the allowlist of kinds the public
  // API serves at all, and projecting through it strips undeclared keys.
  // Person reuses its write schema deliberately (#498): isDBSChecked and
  // hasLeftClub are safeguarding-ADJACENT but public by design - the
  // static site has always rendered the DBS badge and filtered rosters on
  // hasLeftClub, and the content_people gate protects who can WRITE the
  // flags, not who can see them. A future kind whose declared metadata is
  // not fully public must add a dedicated projection schema here.
  const schema = CONTENT_METADATA_SCHEMAS[kind];
  if (!schema) throwHttpError(404, "Content not found");
  const metadata = schema.safeParse(row.metadata);
  if (!metadata.success) {
    throwHttpError(500, "Stored metadata does not match its kind schema");
  }
  return {
    id: row.id,
    kind,
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body as z.infer<typeof contentBodySchema>,
    metadata: metadata.data,
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const publicColumns = [
  "id",
  "kind",
  "slug",
  "title",
  "description",
  "body",
  "metadata",
  "published_at",
  "updated_at",
] as const;

function publishedOnly(db: Kysely<DB>) {
  return db
    .selectFrom("content_item")
    .where("status", "=", "published")
    .where("published_at", "<=", sql<Date>`CURRENT_TIMESTAMP`);
}

export function getPublishedContent(db: Kysely<DB>) {
  return async (params: { kind: ContentKind; slug: string }) => {
    let query = publishedOnly(db)
      .select(publicColumns)
      .where("kind", "=", params.kind)
      .where("slug", "=", params.slug);

    // Page slugs are only unique among siblings, so a bare kind+slug
    // lookup is ambiguous for nested pages. Root pages stay resolvable
    // here (kind+slug is unique where parent_id is null); everything
    // deeper goes through getPublishedPageByPath.
    if (params.kind === "page") {
      query = query.where("parent_id", "is", null);
    }

    const row = await query.executeTakeFirst();

    if (!row) {
      // Person tombstone, mirroring the by-path page rule: the SPA falls
      // back to its bundled static profile on 404, so taking down a
      // migrated profile (unpublish/archive - safeguarding-relevant for
      // people) must not read as "missing" and resurrect the stale
      // static version. Ever-live (past published_at) but not visible
      // now is 410 Gone; never-live rows stay 404 and leak nothing.
      if (params.kind === "person") {
        const tombstone = await db
          .selectFrom("content_item")
          .select("id")
          .where("kind", "=", "person")
          .where("slug", "=", params.slug)
          .where("published_at", "is not", null)
          .where("published_at", "<=", sql<Date>`CURRENT_TIMESTAMP`)
          .executeTakeFirst();
        if (tombstone) throwHttpError(410, "This profile has been removed");
      }
      throwHttpError(404, "Content not found");
    }
    return toPublic(row);
  };
}

export function getPublishedPageByPath(db: Kysely<DB>) {
  return async (path: string) => {
    const row = await publishedOnly(db)
      .select(publicColumns)
      .where("kind", "=", "page")
      .where("path", "=", path)
      .executeTakeFirst();

    if (!row) {
      // Tombstone: the SPA falls back to its bundled static MDX on 404,
      // so an urgent takedown (unpublish/archive of a migrated page)
      // must not read as "missing" and resurrect the stale static
      // version. A row at this path that has EVER been publicly live
      // (past published_at - the same marker as the slug lock) but is
      // not visible now is 410 Gone. Never-live paths (drafts, future
      // schedules, cancelled schedules) stay 404 and leak nothing.
      const tombstone = await db
        .selectFrom("content_item")
        .select("id")
        .where("kind", "=", "page")
        .where("path", "=", path)
        .where("published_at", "is not", null)
        .where("published_at", "<=", sql<Date>`CURRENT_TIMESTAMP`)
        .executeTakeFirst();
      if (tombstone) throwHttpError(410, "This page has been removed");
      throwHttpError(404, "Content not found");
    }
    return toPublic(row);
  };
}

export function getPublishedGameReport(db: Kysely<DB>) {
  return async (playCricketId: string) => {
    const row = await publishedOnly(db)
      .select(publicColumns)
      .where("kind", "=", "game_report")
      .where(sql<string>`metadata->>'playCricketId'`, "=", playCricketId)
      .executeTakeFirst();

    if (!row) throwHttpError(404, "Content not found");
    return toPublic(row);
  };
}

// ── Public: lists ───────────────────────────────────────────────────────

const publicListColumns = [
  "id",
  "slug",
  "title",
  "description",
  "metadata",
  "published_at",
  "updated_at",
] as const;

/** toPublic for list items: same projection, minus the body. */
function toPublicListItem(
  schema: z.ZodType<Record<string, unknown>>,
  row: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    metadata: unknown;
    published_at: Date | null;
    updated_at: Date;
  },
) {
  if (!row.published_at) {
    throwHttpError(500, "Published content missing published_at");
  }
  const metadata = schema.safeParse(row.metadata);
  if (!metadata.success) {
    throwHttpError(500, "Stored metadata does not match its kind schema");
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    metadata: metadata.data,
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function listPublishedNews(db: Kysely<DB>) {
  return async (params: z.infer<typeof listNewsQuerySchema>) => {
    // The five statements must share ONE value of "now": each evaluates
    // CURRENT_TIMESTAMP, and an item crossing its scheduled publish
    // boundary mid-request could otherwise appear in the sidebar
    // aggregates but not in items/total within a single response. In
    // PostgreSQL CURRENT_TIMESTAMP is the transaction start time, so a
    // transaction pins all five to the same clock value. The queries run
    // sequentially: a Kysely transaction holds a single connection,
    // which cannot multiplex concurrent statements.
    return await db.transaction().execute(async (trx) => {
      const publishedNews = () => publishedOnly(trx).where("kind", "=", "news");

      let filtered = publishedNews();
      if (params.tag !== undefined) {
        // jsonb_exists() rather than the ? operator, whose literal question
        // mark is too easily confused with a parameter placeholder.
        filtered = filtered.where(
          sql<boolean>`jsonb_exists(metadata->'tags', ${params.tag})`,
        );
      }

      const items = await filtered
        .select(publicListColumns)
        .orderBy("published_at", "desc")
        // Tiebreaker so identical publish times paginate stably.
        .orderBy("id")
        .limit(params.pageSize)
        .offset((params.page - 1) * params.pageSize)
        .execute();

      const totalRow = await filtered
        .select(sql<string>`COUNT(*)`.as("total"))
        .executeTakeFirstOrThrow();

      // The sidebar aggregates (tags / archive / authorCount) always span
      // every published news item, so they build on publishedNews(), not
      // on the ?tag-filtered query.
      const tagRows = await publishedNews()
        // jsonb_array_elements_text's output column is named "value";
        // the alias here only names the lateral relation.
        .crossJoinLateral(
          sql`jsonb_array_elements_text(metadata->'tags')`.as("tag"),
        )
        .select([
          sql<string>`tag.value`.as("tag"),
          sql<string>`COUNT(*)`.as("count"),
        ])
        .groupBy(sql`tag.value`)
        .orderBy(sql`COUNT(*)`, "desc")
        .orderBy(sql`tag.value`, "asc")
        .execute();

      const archiveRows = await publishedNews()
        .select([
          sql<string>`to_char(published_at AT TIME ZONE 'Europe/London', 'YYYY-MM')`.as(
            "month",
          ),
          sql<string>`COUNT(*)`.as("count"),
        ])
        .groupBy(
          sql`to_char(published_at AT TIME ZONE 'Europe/London', 'YYYY-MM')`,
        )
        .orderBy("month", "desc")
        .execute();

      const authorRow = await publishedNews()
        // COUNT(DISTINCT ...) skips NULLs, so authorless items don't count.
        .select(
          sql<string>`COUNT(DISTINCT metadata->>'authorSlug')`.as("authors"),
        )
        .executeTakeFirstOrThrow();

      return {
        items: items.map((row) => toPublicListItem(newsMetadataSchema, row)),
        total: Number(totalRow.total),
        tags: tagRows.map((r) => ({ tag: r.tag, count: Number(r.count) })),
        archive: archiveRows.map((r) => ({
          month: r.month,
          count: Number(r.count),
        })),
        authorCount: Number(authorRow.authors),
      };
    });
  };
}

export function getPublishedNav(db: Kysely<DB>) {
  return async () => {
    // Every published page's nav fields in one small payload (~30 rows
    // sitewide); the client assembles the tree, breadcrumbs and main
    // menu from the path prefixes. Ordered by path so the order is
    // stable and ancestors precede their descendants.
    const rows = await publishedOnly(db)
      .select(["path", "title", "metadata"])
      .where("kind", "=", "page")
      .orderBy("path", "asc")
      .execute();

    // Tombstoned paths (same ever-live test as the by-path 410): pages
    // that WERE publicly live but are not visible now. The SPA uses
    // these to drop matching entries from its bundled static nav, so a
    // takedown doesn't resurrect the stale static page in menus. The
    // status partition makes the two queries consistent without a
    // transaction: a row is either published (items candidate) or not
    // (removed candidate), never both.
    const removedRows = await db
      .selectFrom("content_item")
      .select("path")
      .where("kind", "=", "page")
      .where("status", "!=", "published")
      .where("published_at", "is not", null)
      .where("published_at", "<=", sql<Date>`CURRENT_TIMESTAMP`)
      .orderBy("path", "asc")
      .execute();

    return {
      items: rows.map((row) => {
        if (row.path === null) {
          throwHttpError(500, "Published page missing its path");
        }
        // Parsing applies the schema defaults (menuOrder 99, flags
        // false) for any keys absent from the stored metadata.
        const metadata = pageMetadataSchema.safeParse(row.metadata);
        if (!metadata.success) {
          throwHttpError(500, "Stored metadata does not match its kind schema");
        }
        return {
          path: row.path,
          title: row.title,
          menuOrder: metadata.data.menuOrder,
          isMainMenu: metadata.data.isMainMenu,
        };
      }),
      removed: removedRows.flatMap((row) =>
        row.path === null ? [] : [row.path],
      ),
    };
  };
}

export function listPublishedEvents(db: Kysely<DB>) {
  return async () => {
    // No pagination: the corpus is tiny and the calendar wants every event.
    // The cast makes ordering chronological even across mixed UTC offsets
    // (the metadata schema guarantees 'when' parses as a timestamptz).
    const rows = await publishedOnly(db)
      .select(publicListColumns)
      .where("kind", "=", "event")
      .orderBy(sql`(metadata->>'when')::timestamptz`, "asc")
      .execute();

    return {
      items: rows.map((row) => toPublicListItem(eventMetadataSchema, row)),
    };
  };
}

export function listPublishedPeople(db: Kysely<DB>) {
  return async () => {
    // No pagination: ~55 profiles sitewide, and every consumer (person
    // cards, grids, the profile pickers in the editor) wants the whole
    // roster in one cached request - resolving cards per-slug would be
    // an N+1 every time a page renders a person grid.
    const rows = await publishedOnly(db)
      .select(publicListColumns)
      .where("kind", "=", "person")
      .orderBy("title", "asc")
      .execute();

    // Tombstoned slugs (same ever-live test as the by-slug 410): people
    // who WERE publicly live but are not visible now. The SPA drops
    // matching entries from its bundled static corpus so a takedown does
    // not resurrect the stale static profile in cards and pickers. The
    // status partition makes the two queries consistent without a
    // transaction: a row is either published (items candidate) or not
    // (removed candidate), never both.
    const removedRows = await db
      .selectFrom("content_item")
      .select("slug")
      .where("kind", "=", "person")
      .where("status", "!=", "published")
      .where("published_at", "is not", null)
      .where("published_at", "<=", sql<Date>`CURRENT_TIMESTAMP`)
      .orderBy("slug", "asc")
      .execute();

    return {
      items: rows.map((row) => toPublicListItem(personMetadataSchema, row)),
      removed: removedRows.map((row) => row.slug),
    };
  };
}
