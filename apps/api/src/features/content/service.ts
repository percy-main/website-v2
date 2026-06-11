import type { DB } from "@percy-main/db";
import {
  CONTENT_METADATA_SCHEMAS,
  contentBodySchema,
  eventMetadataSchema,
  newsMetadataSchema,
  pageMetadataSchema,
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
 * Validate kind-specific metadata against the shared schema map. Kinds
 * without a schema are not editable through the API yet (later phases
 * add theirs).
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

/** Snapshot the item's editorial fields into content_revision. */
async function writeRevision(
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
 * Resolve a prospective parent: must exist and be a page. Returns its
 * path (set at create for every page, so non-null - a NULL here means
 * the row predates hierarchy support, which cannot happen: pages were
 * not editable through the API before it).
 */
async function resolveParentPage(tx: Transaction<DB>, parentId: string) {
  const parent = await tx
    .selectFrom("content_item")
    .select(["id", "kind", "path"])
    .where("id", "=", parentId)
    .executeTakeFirst();
  if (parent?.kind !== "page") {
    throwHttpError(400, "Parent page not found");
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

    return await db.transaction().execute(async (tx) => {
      let path: string | null = null;
      if (params.kind === "page") {
        if (parentId !== null) {
          const parent = await resolveParentPage(tx, parentId);
          path = `${parent.path}/${params.slug}`;
        } else {
          path = `/${params.slug}`;
        }
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
          newPath = `/${slug}`;
        } else {
          if (parentId === current.id) {
            throwHttpError(400, "A page cannot be its own parent");
          }
          const parent = await resolveParentPage(tx, parentId);
          if (parent.path.startsWith(`${oldPath}/`)) {
            throwHttpError(
              400,
              "A page cannot be moved under one of its own descendants",
            );
          }
          newPath = `${parent.path}/${slug}`;
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

      await tx
        .updateTable("content_item")
        .set({
          slug,
          parent_id: parentId,
          path,
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
    const item = await db
      .selectFrom("content_item")
      .select(["kind", "status", "parent_id"])
      .where("id", "=", params.contentId)
      .executeTakeFirst();
    if (!item) throwHttpError(404, "Content not found");
    if (item.status === "archived") {
      throwHttpError(409, "Archived content cannot be published");
    }

    // A page goes live at parent path + slug, so publishing it under an
    // unpublished parent would put a live page on a dead URL prefix
    // (broken breadcrumbs/nav). Publish top-down. Status-based on
    // purpose: a scheduled parent counts, so a whole section can be
    // scheduled together.
    if (item.kind === "page" && item.parent_id !== null) {
      const parent = await db
        .selectFrom("content_item")
        .select("status")
        .where("id", "=", item.parent_id)
        .executeTakeFirst();
      if (parent?.status !== "published") {
        throwHttpError(
          400,
          "Cannot publish this page until its parent page is published",
        );
      }
    }

    let query = db
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
      // The prefetch passed, so this is the ever-live scheduling guard
      // (or a concurrent archive, which the same re-check catches).
      const existing = await db
        .selectFrom("content_item")
        .select("status")
        .where("id", "=", params.contentId)
        .executeTakeFirst();
      if (!existing) throwHttpError(404, "Content not found");
      if (existing.status === "archived") {
        throwHttpError(409, "Archived content cannot be published");
      }
      throwHttpError(
        409,
        "This item has already been live - it can only be published immediately",
      );
    }

    return {
      id: result.id,
      publishedAt: result.published_at?.toISOString() ?? null,
    };
  };
}

export function unpublishContent(db: Kysely<DB>) {
  return async (params: { contentId: string; userId: string }) => {
    const item = await db
      .selectFrom("content_item")
      .select(["kind", "status"])
      .where("id", "=", params.contentId)
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
    // prefix. Unpublish bottom-up.
    if (item.kind === "page") {
      const publishedChild = await db
        .selectFrom("content_item")
        .select("id")
        .where("parent_id", "=", params.contentId)
        .where("status", "=", "published")
        .executeTakeFirst();
      if (publishedChild) {
        throwHttpError(
          400,
          "Cannot unpublish a page that has published child pages - unpublish the children first",
        );
      }
    }

    // A past published_at is deliberately retained: it marks "ever
    // published", which locks the slug. A still-future published_at means
    // a schedule being cancelled before the public ever saw the item, so
    // the ever-published marker is cleared and the slug unlocks.
    // Visibility is otherwise governed by status alone.
    const result = await db
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
      // Race backstop for the prefetched status check.
      .where("status", "=", "published")
      .returning("id")
      .executeTakeFirst();

    if (!result) {
      throwHttpError(409, "Only published content can be unpublished");
    }
    return { id: result.id };
  };
}

export function archiveContent(db: Kysely<DB>) {
  return async (params: { contentId: string; userId: string }) => {
    // Re-archiving must not silently succeed: it would bump
    // updated_at/updated_by for a no-op, misattributing the archive.
    const result = await db
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
      // Either missing or already archived; disambiguate for a useful
      // error (same pattern as publishContent).
      const exists = await db
        .selectFrom("content_item")
        .select("id")
        .where("id", "=", params.contentId)
        .executeTakeFirst();
      throwHttpError(
        exists ? 409 : 404,
        exists ? "Content is already archived" : "Content not found",
      );
    }
    return { id: result.id };
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
  // NOTE for later phases: a kind whose declared metadata is itself not
  // fully public (person carries safeguarding-adjacent flags) must add a
  // dedicated public projection schema here rather than reusing its write
  // schema.
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

    if (!row) throwHttpError(404, "Content not found");
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

    if (!row) throwHttpError(404, "Content not found");
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
