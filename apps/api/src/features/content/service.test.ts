import type { DB } from "@percy-main/db";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type RawBuilder,
} from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExecuteTakeFirst,
  mockExecuteTakeFirstOrThrow,
  mockExecute,
  mockQueryBuilder,
} = vi.hoisted(() => {
  const mockExecuteTakeFirst = vi.fn();
  const mockExecuteTakeFirstOrThrow = vi.fn();
  const mockExecute = vi.fn();

  const mockQueryBuilder: Record<string, unknown> = {
    selectFrom: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    executeTakeFirst: mockExecuteTakeFirst,
    executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
    execute: mockExecute,
  };

  return {
    mockExecuteTakeFirst,
    mockExecuteTakeFirstOrThrow,
    mockExecute,
    mockQueryBuilder,
  };
});

import {
  archiveContent,
  createContent,
  getPublishedGameReport,
  listPageTree,
  publishContent,
  unpublishContent,
  updateContent,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

// Compile-only Kysely (DummyDriver never connects): turns the raw SQL
// expressions the service hands to .set() into inspectable SQL text.
const compilerDb = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (inner) => new PostgresIntrospector(inner),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

/** SQL text (whitespace-normalised) of a column's value in the nth .set() call. */
function setSqlFor(column: string, callIndex = 0): string {
  const setArg = (mockQueryBuilder.set as ReturnType<typeof vi.fn>).mock.calls[
    callIndex
  ]?.[0] as Record<string, RawBuilder<unknown>>;
  const builder = setArg[column];
  if (!builder) throw new Error(`.set() did not include ${column}`);
  return builder.compile(compilerDb).sql.replace(/\s+/g, " ").trim();
}

/** The argument object of the nth .set() call (for plain, non-SQL values). */
function setArgFor(callIndex = 0): Record<string, unknown> {
  const setArg = (mockQueryBuilder.set as ReturnType<typeof vi.fn>).mock.calls[
    callIndex
  ]?.[0] as Record<string, unknown> | undefined;
  if (!setArg) throw new Error(`.set() was not called ${callIndex + 1} times`);
  return setArg;
}

/** The argument object of the nth .values() call. */
function valuesArgFor(callIndex = 0): Record<string, unknown> {
  const arg = (mockQueryBuilder.values as ReturnType<typeof vi.fn>).mock.calls[
    callIndex
  ]?.[0] as Record<string, unknown> | undefined;
  if (!arg) throw new Error(`.values() was not called ${callIndex + 1} times`);
  return arg;
}

/**
 * SQL text (whitespace-normalised) of every raw single-argument .where()
 * guard - the form publishContent's ever-live invariant uses, as opposed
 * to the three-argument column comparisons.
 */
function whereGuardSql(): string[] {
  return (mockQueryBuilder.where as ReturnType<typeof vi.fn>).mock.calls
    .filter((call) => call.length === 1)
    .map((call) =>
      (call[0] as RawBuilder<unknown>)
        .compile(compilerDb)
        .sql.replace(/\s+/g, " ")
        .trim(),
    );
}

const validBody = [
  {
    id: "block-1",
    type: "paragraph",
    props: {},
    content: [{ type: "text", text: "A fine win.", styles: {} }],
    children: [],
  },
];

function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    kind: "game_report" as const,
    slug: "firsts-vs-tynemouth",
    title: "Firsts vs Tynemouth",
    description: null,
    body: validBody,
    metadata: { playCricketId: "6819685" },
    userId: "user-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockQueryBuilder)) {
    const val = mockQueryBuilder[key];
    if (typeof val === "function" && "mockReturnValue" in (val as object)) {
      (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
    }
  }
  // Transactions run the callback against the same mock builder.
  (mockQueryBuilder as { transaction?: unknown }).transaction = vi
    .fn()
    .mockReturnValue({
      execute: (cb: (tx: unknown) => unknown) => cb(mockQueryBuilder),
    });
  mockExecuteTakeFirst.mockResolvedValue(undefined);
  mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "content-1" });
});

describe("createContent", () => {
  it("rejects kinds that are not editable yet", async () => {
    await expect(
      createContent(db)(validCreate({ kind: "person", metadata: {} })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects metadata that fails the kind schema", async () => {
    await expect(
      createContent(db)(validCreate({ metadata: {} })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createContent(db)(validCreate({ metadata: {} })),
    ).rejects.toThrow(/playCricketId/);
  });

  it("rejects a structurally invalid body", async () => {
    await expect(
      createContent(db)(validCreate({ body: [{ type: "paragraph" }] })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a duplicate slug for the kind", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({ id: "existing" });
    await expect(createContent(db)(validCreate())).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("creates the item and returns its id", async () => {
    const result = await createContent(db)(validCreate());
    expect(result).toEqual({ id: "content-1" });
  });
});

describe("news and event metadata", () => {
  const newsCreate = (metadata: Record<string, unknown>) =>
    validCreate({
      kind: "news" as const,
      slug: "summer-fair-roundup",
      title: "Summer fair roundup",
      metadata,
    });
  const eventCreate = (metadata: Record<string, unknown>) =>
    validCreate({
      kind: "event" as const,
      slug: "quiz-night",
      title: "Quiz night",
      metadata,
    });

  it("creates news with tags and an author", async () => {
    const result = await createContent(db)(
      newsCreate({ tags: ["seniors"], authorSlug: "alice-smith" }),
    );
    expect(result).toEqual({ id: "content-1" });
  });

  it("rejects an authorSlug that is not slug-shaped", async () => {
    await expect(
      createContent(db)(newsCreate({ tags: [], authorSlug: "Alice Smith" })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("creates an event with a finish and a full location", async () => {
    const result = await createContent(db)(
      eventCreate({
        when: "2026-07-04T18:30:00+01:00",
        finish: "2026-07-04T22:00:00+01:00",
        location: {
          name: "The Clubhouse",
          street: "St John's Terrace",
          city: "North Shields",
          postcode: "NE29 6HS",
          lat: 55.004,
          lon: -1.453,
        },
      }),
    );
    expect(result).toEqual({ id: "content-1" });
  });

  it("rejects an event without a when", async () => {
    await expect(
      createContent(db)(eventCreate({ finish: "2026-07-04T22:00:00+01:00" })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createContent(db)(eventCreate({ finish: "2026-07-04T22:00:00+01:00" })),
    ).rejects.toThrow(/when/);
  });

  it("rejects a location missing its postcode", async () => {
    await expect(
      createContent(db)(
        eventCreate({
          when: "2026-07-04T18:30:00+01:00",
          location: {
            name: "The Clubhouse",
            street: "St John's Terrace",
            city: "North Shields",
          },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("strips unknown metadata keys, like every other kind", async () => {
    await createContent(db)(
      newsCreate({ tags: ["seniors"], county: "Tyne and Wear" }),
    );
    const inserted = (mockQueryBuilder.values as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { metadata: string };
    expect(JSON.parse(inserted.metadata)).toEqual({ tags: ["seniors"] });
  });

  it("validates news metadata on the update path too", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({
      id: "content-1",
      kind: "news",
      slug: "summer-fair-roundup",
      title: "Summer fair roundup",
      description: null,
      body: validBody,
      metadata: { tags: ["seniors"] },
      published_at: null,
    });
    await expect(
      updateContent(db)({
        contentId: "content-1",
        userId: "user-1",
        metadata: { tags: "seniors" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("updateContent", () => {
  const currentRow = {
    id: "content-1",
    kind: "game_report",
    slug: "firsts-vs-tynemouth",
    title: "Firsts vs Tynemouth",
    description: null,
    body: validBody,
    metadata: { playCricketId: "6819685" },
    published_at: null,
  };

  it("404s when the item does not exist", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
    await expect(
      updateContent(db)({
        contentId: "missing",
        userId: "user-1",
        title: "New",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("locks the slug once the item has ever been published", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({
      ...currentRow,
      published_at: new Date("2026-06-01T10:00:00Z"),
    });
    await expect(
      updateContent(db)({
        contentId: "content-1",
        userId: "user-1",
        slug: "different-slug",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("allows a slug change while never published", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(currentRow) // fetch current
      .mockResolvedValueOnce(undefined); // slug clash check
    const result = await updateContent(db)({
      contentId: "content-1",
      userId: "user-1",
      slug: "different-slug",
    });
    expect(result).toEqual({ id: "content-1" });
  });

  it("rejects a parentId on non-page kinds", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(currentRow); // game_report
    await expect(
      updateContent(db)({
        contentId: "content-1",
        userId: "user-1",
        parentId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Only pages can have a parent page",
    });
  });
});

describe("page hierarchy: createContent", () => {
  const pageCreate = (overrides: Record<string, unknown> = {}) =>
    validCreate({
      kind: "page" as const,
      slug: "about",
      title: "About",
      metadata: {},
      ...overrides,
    });

  it("rejects a parentId on non-page kinds", async () => {
    await expect(
      createContent(db)(validCreate({ parentId: "parent-1" })),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Only pages can have a parent page",
    });
  });

  it("computes a root page's path and applies metadata defaults", async () => {
    const result = await createContent(db)(pageCreate());
    expect(result).toEqual({ id: "content-1" });
    const inserted = valuesArgFor() as { metadata: string };
    expect(valuesArgFor()).toMatchObject({
      parent_id: null,
      path: "/about",
    });
    expect(JSON.parse(inserted.metadata)).toEqual({
      menuOrder: 99,
      isMainMenu: false,
      hideTitle: false,
    });
  });

  it("computes a child page's path from its parent's", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ id: "parent-1", kind: "page", path: "/cricket" }) // parent fetch
      .mockResolvedValueOnce(undefined); // sibling slug check
    const result = await createContent(db)(
      pageCreate({ slug: "juniors", parentId: "parent-1" }),
    );
    expect(result).toEqual({ id: "content-1" });
    expect(valuesArgFor()).toMatchObject({
      parent_id: "parent-1",
      path: "/cricket/juniors",
    });
  });

  it("rejects a parent that does not exist", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // parent fetch
    await expect(
      createContent(db)(pageCreate({ parentId: "missing" })),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Parent page not found",
    });
  });

  it("rejects a parent that is not a page", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({
      id: "news-1",
      kind: "news",
      path: null,
    });
    await expect(
      createContent(db)(pageCreate({ parentId: "news-1" })),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Parent page not found",
    });
  });

  it("keeps parent_id and path NULL for non-page kinds", async () => {
    await createContent(db)(validCreate());
    expect(valuesArgFor()).toMatchObject({ parent_id: null, path: null });
  });
});

describe("page hierarchy: updateContent", () => {
  const pageRow = {
    id: "page-1",
    kind: "page",
    slug: "cricket",
    parent_id: null,
    path: "/cricket",
    title: "Cricket",
    description: null,
    body: validBody,
    metadata: { menuOrder: 1, isMainMenu: true, hideTitle: false },
    published_at: null,
  };

  it("recomputes the path on slug change and cascades to descendants", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(pageRow) // fetch current
      .mockResolvedValueOnce(undefined); // sibling slug check
    mockExecute.mockResolvedValueOnce([
      { id: "child-1", path: "/cricket/juniors", published_at: null },
      {
        id: "grandchild-1",
        path: "/cricket/juniors/coaches",
        published_at: null,
      },
    ]); // descendants
    const result = await updateContent(db)({
      contentId: "page-1",
      userId: "user-1",
      slug: "playing",
    });
    expect(result).toEqual({ id: "page-1" });
    // Main update rewrites the page's own path...
    expect(setArgFor(0)).toMatchObject({
      slug: "playing",
      parent_id: null,
      path: "/playing",
    });
    // ...and the cascade re-prefixes every descendant in one statement:
    // new prefix ($1) + the tail of the old path (substr past '/cricket').
    expect(setSqlFor("path", 1)).toBe("$1 || substr(path, 9)");
    const cascadeWhere = (
      mockQueryBuilder.where as ReturnType<typeof vi.fn>
    ).mock.calls.find((call) => call[1] === "in");
    expect(cascadeWhere?.[2]).toEqual(["child-1", "grandchild-1"]);
  });

  it("recomputes the path on parent change", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(pageRow) // fetch current
      .mockResolvedValueOnce({ id: "parent-2", kind: "page", path: "/club" }) // new parent
      .mockResolvedValueOnce(undefined); // sibling slug check
    mockExecute.mockResolvedValueOnce([]); // no descendants
    await updateContent(db)({
      contentId: "page-1",
      userId: "user-1",
      parentId: "parent-2",
    });
    expect(setArgFor(0)).toMatchObject({
      slug: "cricket",
      parent_id: "parent-2",
      path: "/club/cricket",
    });
  });

  it("locks slug and parent once the page has ever been published", async () => {
    const published = {
      ...pageRow,
      published_at: new Date("2026-06-01T10:00:00Z"),
    };
    mockExecuteTakeFirst.mockResolvedValueOnce(published);
    await expect(
      updateContent(db)({
        contentId: "page-1",
        userId: "user-1",
        slug: "playing",
      }),
    ).rejects.toMatchObject({ statusCode: 409, message: /locked/ });

    mockExecuteTakeFirst.mockResolvedValueOnce(published);
    await expect(
      updateContent(db)({
        contentId: "page-1",
        userId: "user-1",
        parentId: "parent-2",
      }),
    ).rejects.toMatchObject({ statusCode: 409, message: /locked/ });
  });

  it("rejects a slug change that would move an ever-published descendant", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(pageRow);
    mockExecute.mockResolvedValueOnce([
      {
        id: "child-1",
        path: "/cricket/juniors",
        published_at: new Date("2026-06-01T10:00:00Z"),
      },
    ]);
    await expect(
      updateContent(db)({
        contentId: "page-1",
        userId: "user-1",
        slug: "playing",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: /descendant page '\/cricket\/juniors' has been published/,
    });
  });

  it("rejects making a page its own parent", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(pageRow);
    mockExecute.mockResolvedValueOnce([]); // descendants
    await expect(
      updateContent(db)({
        contentId: "page-1",
        userId: "user-1",
        parentId: "page-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "A page cannot be its own parent",
    });
  });

  it("rejects moving a page under one of its own descendants", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(pageRow).mockResolvedValueOnce({
      id: "child-1",
      kind: "page",
      path: "/cricket/juniors",
    }); // new parent = descendant
    mockExecute.mockResolvedValueOnce([
      { id: "child-1", path: "/cricket/juniors", published_at: null },
    ]);
    await expect(
      updateContent(db)({
        contentId: "page-1",
        userId: "user-1",
        parentId: "child-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "A page cannot be moved under one of its own descendants",
    });
  });
});

describe("publishContent", () => {
  // Call order inside the transaction: 1. unlocked peek (kind/parent_id)
  // 2. [pages with a parent] parent row FOR UPDATE 3. item row FOR
  // UPDATE 4. the UPDATE itself.
  const peeked = { kind: "game_report", status: "draft", parent_id: null };
  const pagePeek = { kind: "page", status: "draft", parent_id: "p1" };
  const liveParent = {
    status: "published",
    published_at: new Date("2026-06-01T10:00:00Z"),
    live_now: true,
  };

  it("404s when the item does not exist", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // peek
    await expect(
      publishContent(db)({ contentId: "missing", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("409s when the item is archived", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(peeked)
      .mockResolvedValueOnce({ ...peeked, status: "archived" }); // locked item
    await expect(
      publishContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Archived content cannot be published",
    });
  });

  it("returns the effective publishedAt", async () => {
    const at = new Date("2026-07-01T10:00:00Z");
    mockExecuteTakeFirst
      .mockResolvedValueOnce(peeked)
      .mockResolvedValueOnce(peeked) // locked item
      .mockResolvedValueOnce({ id: "content-1", published_at: at });
    const result = await publishContent(db)({
      contentId: "content-1",
      publishedAt: at.toISOString(),
      userId: "user-1",
    });
    expect(result).toEqual({
      id: "content-1",
      publishedAt: at.toISOString(),
    });
  });

  it("passes an explicit publishedAt through as a concrete date", async () => {
    const at = new Date("2026-07-01T10:00:00Z");
    mockExecuteTakeFirst
      .mockResolvedValueOnce(peeked)
      .mockResolvedValueOnce(peeked) // locked item
      .mockResolvedValueOnce({ id: "content-1", published_at: at });
    await publishContent(db)({
      contentId: "content-1",
      publishedAt: at.toISOString(),
      userId: "user-1",
    });
    expect(setArgFor().published_at).toEqual(at);
  });

  it("publish-now keeps published_at only when already past (DB-clock CASE)", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(peeked)
      .mockResolvedValueOnce(peeked) // locked item
      .mockResolvedValueOnce({
        id: "content-1",
        published_at: new Date("2026-06-01T10:00:00Z"),
      });
    await publishContent(db)({ contentId: "content-1", userId: "user-1" });
    // NULL or a still-future schedule must fall through to now(); only a
    // past live-from date survives a dateless publish.
    expect(setSqlFor("published_at")).toBe(
      "CASE WHEN published_at <= CURRENT_TIMESTAMP THEN published_at ELSE CURRENT_TIMESTAMP END",
    );
    // A dateless publish can never violate the ever-live invariant, so
    // no raw WHERE guard is attached.
    expect(whereGuardSql()).toEqual([]);
  });

  it("guards the ever-live invariant in the UPDATE's WHERE (DB clock)", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(peeked)
      .mockResolvedValueOnce(peeked) // locked item
      .mockResolvedValueOnce({
        id: "content-1",
        published_at: new Date("2027-01-01T10:00:00Z"),
      });
    await publishContent(db)({
      contentId: "content-1",
      publishedAt: "2027-01-01T10:00:00Z",
      userId: "user-1",
    });
    // The IS NOT NULL keeps a first publish (NULL published_at) from
    // NULL-ing the whole predicate and blocking the row.
    expect(whereGuardSql()).toEqual([
      "NOT ( published_at IS NOT NULL AND published_at <= CURRENT_TIMESTAMP AND $1::timestamptz > CURRENT_TIMESTAMP )",
    ]);
  });

  it("409s when scheduling an item that has already been live", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ ...peeked, status: "published" }) // peek
      .mockResolvedValueOnce({ ...peeked, status: "published" }) // locked item
      .mockResolvedValueOnce(undefined); // ever-live guard excluded the row
    await expect(
      publishContent(db)({
        contentId: "content-1",
        publishedAt: "2027-01-01T10:00:00Z",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "This item has already been live - it can only be published immediately",
    });
  });

  it("400s when publishing a page whose parent is not published", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(pagePeek)
      .mockResolvedValueOnce({
        status: "draft",
        published_at: null,
        live_now: null,
      }) // locked parent
      .mockResolvedValueOnce(pagePeek); // locked item
    await expect(
      publishContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Cannot publish this page until its parent page is published",
    });
  });

  it("publishes a page under a live parent", async () => {
    const at = new Date("2026-06-02T10:00:00Z");
    mockExecuteTakeFirst
      .mockResolvedValueOnce(pagePeek)
      .mockResolvedValueOnce(liveParent) // locked parent
      .mockResolvedValueOnce(pagePeek) // locked item
      .mockResolvedValueOnce({ id: "content-1", published_at: at }); // update
    const result = await publishContent(db)({
      contentId: "content-1",
      userId: "user-1",
    });
    expect(result).toEqual({ id: "content-1", publishedAt: at.toISOString() });
  });

  it("publishes a root page without any parent check", async () => {
    const at = new Date("2026-06-01T10:00:00Z");
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ kind: "page", status: "draft", parent_id: null })
      .mockResolvedValueOnce({ kind: "page", status: "draft", parent_id: null })
      .mockResolvedValueOnce({ id: "content-1", published_at: at }); // update
    const result = await publishContent(db)({
      contentId: "content-1",
      userId: "user-1",
    });
    expect(result).toEqual({ id: "content-1", publishedAt: at.toISOString() });
  });

  it("rejects publish-now while the parent is still scheduled", async () => {
    const parentAt = new Date("2027-01-01T10:00:00Z");
    mockExecuteTakeFirst
      .mockResolvedValueOnce(pagePeek)
      .mockResolvedValueOnce({
        status: "published",
        published_at: parentAt,
        live_now: false, // scheduled: not yet live on the DB clock
      })
      .mockResolvedValueOnce(pagePeek); // locked item
    await expect(
      publishContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: `Parent page goes live at ${parentAt.toISOString()}; schedule this page for that time or later`,
    });
  });

  it("rejects scheduling (or backdating) a child before the parent's go-live", async () => {
    const parentAt = new Date("2027-01-01T10:00:00Z");
    mockExecuteTakeFirst
      .mockResolvedValueOnce(pagePeek)
      .mockResolvedValueOnce({
        status: "published",
        published_at: parentAt,
        live_now: false,
      })
      .mockResolvedValueOnce(pagePeek); // locked item
    await expect(
      publishContent(db)({
        contentId: "content-1",
        publishedAt: "2026-12-31T10:00:00Z",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: `Parent page goes live at ${parentAt.toISOString()}; schedule this page for that time or later`,
    });
  });

  it("allows scheduling a child at the parent's exact go-live time", async () => {
    const parentAt = new Date("2027-01-01T10:00:00Z");
    mockExecuteTakeFirst
      .mockResolvedValueOnce(pagePeek)
      .mockResolvedValueOnce({
        status: "published",
        published_at: parentAt,
        live_now: false,
      })
      .mockResolvedValueOnce(pagePeek) // locked item
      .mockResolvedValueOnce({ id: "content-1", published_at: parentAt });
    const result = await publishContent(db)({
      contentId: "content-1",
      publishedAt: parentAt.toISOString(),
      userId: "user-1",
    });
    expect(result).toEqual({
      id: "content-1",
      publishedAt: parentAt.toISOString(),
    });
  });
});

describe("archiveContent", () => {
  it("404s when the item does not exist", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // locked item
    await expect(
      archiveContent(db)({ contentId: "missing", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("409s when the item is already archived", async () => {
    // Re-archiving must not silently bump updated_at/updated_by.
    mockExecuteTakeFirst.mockResolvedValueOnce({
      kind: "game_report",
      status: "archived",
    });
    await expect(
      archiveContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Content is already archived",
    });
  });

  it("archives a non-archived item", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ kind: "game_report", status: "draft" })
      .mockResolvedValueOnce({ id: "content-1" }); // update
    const result = await archiveContent(db)({
      contentId: "content-1",
      userId: "user-1",
    });
    expect(result).toEqual({ id: "content-1" });
  });

  it("409s when archiving a page that has published children", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ kind: "page", status: "published" }) // locked item
      .mockResolvedValueOnce({ id: "child-1" }); // published-child probe
    await expect(
      archiveContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "Cannot archive a page that has published child pages - unpublish or archive the children first",
    });
  });

  it("archives a page whose children are all drafts", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ kind: "page", status: "published" }) // locked item
      .mockResolvedValueOnce(undefined) // no published child
      .mockResolvedValueOnce({ id: "content-1" }); // update
    const result = await archiveContent(db)({
      contentId: "content-1",
      userId: "user-1",
    });
    expect(result).toEqual({ id: "content-1" });
  });
});

describe("unpublishContent", () => {
  it("409s when the item is not currently published", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({
      kind: "game_report",
      status: "draft",
    }); // prefetch
    await expect(
      unpublishContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("404s when the item does not exist", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined); // prefetch
    await expect(
      unpublishContent(db)({ contentId: "missing", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("clears published_at only while it is still in the future (DB-clock CASE)", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ kind: "game_report", status: "published" })
      .mockResolvedValueOnce({ id: "content-1" }); // update
    await unpublishContent(db)({ contentId: "content-1", userId: "user-1" });
    // Cancelling a schedule that never went live clears the
    // ever-published marker (unlocking the slug); a past published_at -
    // the item was publicly visible - is retained.
    expect(setSqlFor("published_at")).toBe(
      "CASE WHEN published_at > CURRENT_TIMESTAMP THEN NULL ELSE published_at END",
    );
  });

  it("400s when unpublishing a page that has published children", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ kind: "page", status: "published" }) // prefetch
      .mockResolvedValueOnce({ id: "child-1" }); // published-child probe
    await expect(
      unpublishContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message:
        "Cannot unpublish a page that has published child pages - unpublish the children first",
    });
  });

  it("unpublishes a page whose children are all unpublished", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce({ kind: "page", status: "published" }) // prefetch
      .mockResolvedValueOnce(undefined) // no published child
      .mockResolvedValueOnce({ id: "content-1" }); // update
    const result = await unpublishContent(db)({
      contentId: "content-1",
      userId: "user-1",
    });
    expect(result).toEqual({ id: "content-1" });
  });
});

describe("listPageTree", () => {
  const pageRow = (overrides: Record<string, unknown> = {}) => ({
    id: "page-1",
    title: "Cricket",
    slug: "cricket",
    path: "/cricket",
    parent_id: null,
    metadata: { menuOrder: 1, isMainMenu: true, hideTitle: false },
    status: "draft",
    published_at: null,
    updated_at: new Date("2026-06-02T10:00:00Z"),
    ...overrides,
  });

  it("maps rows: hierarchy fields, metadata values and timestamps", async () => {
    mockExecute.mockResolvedValueOnce([
      pageRow(),
      pageRow({
        id: "page-2",
        title: "Juniors",
        slug: "juniors",
        path: "/cricket/juniors",
        parent_id: "page-1",
        status: "published",
        published_at: new Date("2026-06-01T10:00:00Z"),
      }),
    ]);
    const { items } = await listPageTree(db)();
    expect(items).toEqual([
      {
        id: "page-1",
        title: "Cricket",
        slug: "cricket",
        path: "/cricket",
        parentId: null,
        menuOrder: 1,
        isMainMenu: true,
        status: "draft",
        publishedAt: null,
        updatedAt: "2026-06-02T10:00:00.000Z",
        pathLocked: false,
      },
      {
        id: "page-2",
        title: "Juniors",
        slug: "juniors",
        path: "/cricket/juniors",
        parentId: "page-1",
        menuOrder: 1,
        isMainMenu: true,
        status: "published",
        publishedAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-02T10:00:00.000Z",
        pathLocked: true,
      },
    ]);
  });

  it("derives pathLocked from the ever-published marker, not status", async () => {
    // Unpublish retains a past published_at (the item WAS live), so a
    // draft can still be locked; archive never touches the marker.
    mockExecute.mockResolvedValueOnce([
      pageRow({
        status: "draft",
        published_at: new Date("2026-06-01T10:00:00Z"),
      }),
      pageRow({ id: "page-2", path: "/club", status: "archived" }),
    ]);
    const { items } = await listPageTree(db)();
    expect(items[0]).toMatchObject({ status: "draft", pathLocked: true });
    expect(items[1]).toMatchObject({ status: "archived", pathLocked: false });
  });

  it("applies schema defaults for keys absent from stored metadata", async () => {
    mockExecute.mockResolvedValueOnce([pageRow({ metadata: {} })]);
    const { items } = await listPageTree(db)();
    expect(items[0]).toMatchObject({ menuOrder: 99, isMainMenu: false });
  });

  it("degrades malformed stored metadata to pure defaults", async () => {
    mockExecute.mockResolvedValueOnce([
      pageRow({ metadata: { menuOrder: "first", isMainMenu: "yes" } }),
    ]);
    const { items } = await listPageTree(db)();
    expect(items[0]).toMatchObject({ menuOrder: 99, isMainMenu: false });
  });

  it("500s on a page with no path (data problem, not a request error)", async () => {
    mockExecute.mockResolvedValueOnce([pageRow({ path: null })]);
    await expect(listPageTree(db)()).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});

describe("getPublishedGameReport", () => {
  it("404s when no published report matches", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce(undefined);
    await expect(getPublishedGameReport(db)("6819685")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("maps a published row to the public shape", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({
      id: "content-1",
      kind: "game_report",
      slug: "firsts-vs-tynemouth",
      title: "Firsts vs Tynemouth",
      description: null,
      body: validBody,
      metadata: { playCricketId: "6819685" },
      published_at: new Date("2026-06-01T10:00:00Z"),
      updated_at: new Date("2026-06-02T10:00:00Z"),
    });
    const result = await getPublishedGameReport(db)("6819685");
    expect(result.publishedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(result.body).toEqual(validBody);
  });
});
