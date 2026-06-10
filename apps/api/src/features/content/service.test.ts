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

const { mockExecuteTakeFirst, mockExecuteTakeFirstOrThrow, mockQueryBuilder } =
  vi.hoisted(() => {
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
  createContent,
  getPublishedGameReport,
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

/** SQL text (whitespace-normalised) of a column's value in the first .set() call. */
function setSqlFor(column: string): string {
  const setArg = (mockQueryBuilder.set as ReturnType<typeof vi.fn>).mock
    .calls[0]?.[0] as Record<string, RawBuilder<unknown>>;
  const builder = setArg[column];
  if (!builder) throw new Error(`.set() did not include ${column}`);
  return builder.compile(compilerDb).sql.replace(/\s+/g, " ").trim();
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
});

describe("publishContent", () => {
  it("404s when the item does not exist", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(undefined) // update returning nothing
      .mockResolvedValueOnce(undefined); // existence check
    await expect(
      publishContent(db)({ contentId: "missing", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("409s when the item is archived", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(undefined) // update skipped archived row
      .mockResolvedValueOnce({ id: "content-1" }); // but it exists
    await expect(
      publishContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("returns the effective publishedAt", async () => {
    const at = new Date("2026-07-01T10:00:00Z");
    mockExecuteTakeFirst.mockResolvedValueOnce({
      id: "content-1",
      published_at: at,
    });
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
    mockExecuteTakeFirst.mockResolvedValueOnce({
      id: "content-1",
      published_at: at,
    });
    await publishContent(db)({
      contentId: "content-1",
      publishedAt: at.toISOString(),
      userId: "user-1",
    });
    const setArg = (mockQueryBuilder.set as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { published_at: unknown };
    expect(setArg.published_at).toEqual(at);
  });

  it("publish-now keeps published_at only when already past (DB-clock CASE)", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({
      id: "content-1",
      published_at: new Date("2026-06-01T10:00:00Z"),
    });
    await publishContent(db)({ contentId: "content-1", userId: "user-1" });
    // NULL or a still-future schedule must fall through to now(); only a
    // past live-from date survives a dateless publish.
    expect(setSqlFor("published_at")).toBe(
      "CASE WHEN published_at <= CURRENT_TIMESTAMP THEN published_at ELSE CURRENT_TIMESTAMP END",
    );
  });
});

describe("unpublishContent", () => {
  it("409s when the item is not currently published", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(undefined) // update matched nothing
      .mockResolvedValueOnce({ id: "content-1" }); // but it exists
    await expect(
      unpublishContent(db)({ contentId: "content-1", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("404s when the item does not exist", async () => {
    mockExecuteTakeFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await expect(
      unpublishContent(db)({ contentId: "missing", userId: "user-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("clears published_at only while it is still in the future (DB-clock CASE)", async () => {
    mockExecuteTakeFirst.mockResolvedValueOnce({ id: "content-1" });
    await unpublishContent(db)({ contentId: "content-1", userId: "user-1" });
    // Cancelling a schedule that never went live clears the
    // ever-published marker (unlocking the slug); a past published_at -
    // the item was publicly visible - is retained.
    expect(setSqlFor("published_at")).toBe(
      "CASE WHEN published_at > CURRENT_TIMESTAMP THEN NULL ELSE published_at END",
    );
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
