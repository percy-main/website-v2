import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  archiveContent,
  createContent,
  getContent,
  getPublishedContent,
  getPublishedGameReport,
  listContent,
  listPublishedEvents,
  listPublishedNews,
  listRevisions,
  publishContent,
  unpublishContent,
  updateContent,
} from "./service.ts";

const body = (text: string) => [
  {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  },
];

describe("content service (integration)", () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = await startTestContainer();
    ({ userId } = await seedTestUser(ctx.db, { withMember: false }));
  }, 120_000);

  afterAll(async () => {
    await stopTestContainer(ctx);
  });

  it("walks a game report through its full lifecycle", async () => {
    // Create: starts draft, writes the creation revision
    const { id } = await createContent(ctx.db)({
      kind: "game_report",
      slug: "firsts-vs-tynemouth",
      title: "Firsts vs Tynemouth",
      description: "A nail-biter at Preston Avenue",
      body: body("What a game."),
      metadata: { playCricketId: "111111" },
      userId,
    });

    const draft = await getContent(ctx.db)(id);
    expect(draft.status).toBe("draft");
    expect(draft.publishedAt).toBeNull();

    // Draft content is never served publicly
    await expect(
      getPublishedContent(ctx.db)({
        kind: "game_report",
        slug: "firsts-vs-tynemouth",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    // Update writes a second revision
    await updateContent(ctx.db)({
      contentId: id,
      title: "Firsts vs Tynemouth CC",
      body: body("What a game. Updated."),
      userId,
    });
    const { revisions } = await listRevisions(ctx.db)(id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.title).toBe("Firsts vs Tynemouth CC");

    // Publish: now publicly visible by slug and by playCricketId
    await publishContent(ctx.db)({ contentId: id, userId });
    const pub = await getPublishedContent(ctx.db)({
      kind: "game_report",
      slug: "firsts-vs-tynemouth",
    });
    expect(pub.title).toBe("Firsts vs Tynemouth CC");
    const byPcId = await getPublishedGameReport(ctx.db)("111111");
    expect(byPcId.id).toBe(id);

    // Slug locks after first publish
    await expect(
      updateContent(ctx.db)({ contentId: id, slug: "new-slug", userId }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Unpublish hides it again, slug stays locked
    await unpublishContent(ctx.db)({ contentId: id, userId });
    await expect(
      getPublishedGameReport(ctx.db)("111111"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      updateContent(ctx.db)({ contentId: id, slug: "new-slug", userId }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Archive blocks re-publish, and unpublish offers no back door out
    await archiveContent(ctx.db)({ contentId: id, userId });
    await expect(
      publishContent(ctx.db)({ contentId: id, userId }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      unpublishContent(ctx.db)({ contentId: id, userId }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("hides scheduled content until its publish time", async () => {
    const { id } = await createContent(ctx.db)({
      kind: "game_report",
      slug: "scheduled-report",
      title: "Scheduled report",
      description: null,
      body: body("Coming soon."),
      metadata: { playCricketId: "222222" },
      userId,
    });

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await publishContent(ctx.db)({
      contentId: id,
      publishedAt: future,
      userId,
    });
    expect(result.publishedAt).toBe(future);

    await expect(
      getPublishedGameReport(ctx.db)("222222"),
    ).rejects.toMatchObject({ statusCode: 404 });

    // Re-publish with a past time -> immediately visible
    const past = new Date(Date.now() - 1000).toISOString();
    await publishContent(ctx.db)({ contentId: id, publishedAt: past, userId });
    const pub = await getPublishedGameReport(ctx.db)("222222");
    expect(pub.id).toBe(id);

    // Publishing again without a date keeps the original live-from time
    const again = await publishContent(ctx.db)({ contentId: id, userId });
    expect(again.publishedAt).toBe(past);
  });

  it("enforces per-kind slug uniqueness on create", async () => {
    await createContent(ctx.db)({
      kind: "game_report",
      slug: "dupe-slug",
      title: "First",
      description: null,
      body: body("One."),
      metadata: { playCricketId: "333333" },
      userId,
    });

    await expect(
      createContent(ctx.db)({
        kind: "game_report",
        slug: "dupe-slug",
        title: "Second",
        description: null,
        body: body("Two."),
        metadata: { playCricketId: "444444" },
        userId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects a second game report for the same Play-Cricket match", async () => {
    await createContent(ctx.db)({
      kind: "game_report",
      slug: "pc-dupe-one",
      title: "First",
      description: null,
      body: body("One."),
      metadata: { playCricketId: "777777" },
      userId,
    });

    // Duplicate on create (even as a draft)
    await expect(
      createContent(ctx.db)({
        kind: "game_report",
        slug: "pc-dupe-two",
        title: "Second",
        description: null,
        body: body("Two."),
        metadata: { playCricketId: "777777" },
        userId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Duplicate via metadata update
    const other = await createContent(ctx.db)({
      kind: "game_report",
      slug: "pc-dupe-three",
      title: "Third",
      description: null,
      body: body("Three."),
      metadata: { playCricketId: "888888" },
      userId,
    });
    await expect(
      updateContent(ctx.db)({
        contentId: other.id,
        metadata: { playCricketId: "777777" },
        userId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("filters and paginates the admin list", async () => {
    const mk = (n: number) =>
      createContent(ctx.db)({
        kind: "game_report",
        slug: `list-report-${n}`,
        title: `List report ${n}`,
        description: null,
        body: body(`Report ${n}.`),
        metadata: { playCricketId: `55${n}` },
        userId,
      });
    const created = [];
    for (let n = 0; n < 3; n++) created.push(await mk(n));
    const [first] = created;
    if (!first) throw new Error("expected created items");
    await publishContent(ctx.db)({ contentId: first.id, userId });

    const drafts = await listContent(ctx.db)({
      kind: "game_report",
      status: "draft",
      search: "List report",
      page: 1,
      pageSize: 10,
    });
    expect(drafts.total).toBe(2);
    expect(drafts.items.every((i) => i.status === "draft")).toBe(true);

    const paged = await listContent(ctx.db)({
      kind: "game_report",
      search: "List report",
      page: 2,
      pageSize: 2,
      status: undefined,
    });
    expect(paged.total).toBe(3);
    expect(paged.items).toHaveLength(1);
  });

  it("keeps every revision forever, attributed to the saver", async () => {
    const { id } = await createContent(ctx.db)({
      kind: "game_report",
      slug: "revision-history",
      title: "v1",
      description: null,
      body: body("v1"),
      metadata: { playCricketId: "666666" },
      userId,
    });
    await updateContent(ctx.db)({ contentId: id, title: "v2", userId });
    await updateContent(ctx.db)({ contentId: id, title: "v3", userId });

    const { revisions } = await listRevisions(ctx.db)(id);
    expect(revisions.map((r) => r.title)).toEqual(["v3", "v2", "v1"]);
    expect(revisions.every((r) => r.savedBy === userId)).toBe(true);
  });

  it("404s revision listing for unknown content", async () => {
    await expect(
      listRevisions(ctx.db)(crypto.randomUUID()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  describe("public news and events lists", () => {
    const seedNews = async (
      item: { slug: string; tags: string[]; authorSlug?: string },
      publishedAt?: string,
    ) => {
      const { id } = await createContent(ctx.db)({
        kind: "news",
        slug: item.slug,
        title: `News ${item.slug}`,
        description: null,
        body: body(item.slug),
        metadata: {
          tags: item.tags,
          ...(item.authorSlug !== undefined
            ? { authorSlug: item.authorSlug }
            : {}),
        },
        userId,
      });
      if (publishedAt !== undefined) {
        await publishContent(ctx.db)({ contentId: id, publishedAt, userId });
      }
    };

    beforeAll(async () => {
      // Four published items across three London months, plus a draft and
      // a scheduled item that must never surface in the public list.
      await seedNews(
        {
          slug: "news-jan",
          tags: ["seniors", "social"],
          authorSlug: "alice-smith",
        },
        "2026-01-15T12:00:00Z",
      );
      await seedNews(
        {
          slug: "news-feb-early",
          tags: ["seniors"],
          authorSlug: "alice-smith",
        },
        "2026-02-10T12:00:00Z",
      );
      await seedNews(
        { slug: "news-feb-late", tags: ["juniors"], authorSlug: "bob-jones" },
        "2026-02-20T12:00:00Z",
      );
      await seedNews(
        { slug: "news-mar", tags: ["social"] },
        "2026-03-05T12:00:00Z",
      );
      await seedNews({
        slug: "news-draft",
        tags: ["seniors"],
        authorSlug: "carol-day",
      });
      await seedNews(
        { slug: "news-future", tags: ["seniors"], authorSlug: "carol-day" },
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      );
    });

    it("paginates published news newest first, excluding drafts and scheduled items", async () => {
      const page1 = await listPublishedNews(ctx.db)({ page: 1, pageSize: 3 });
      expect(page1.total).toBe(4);
      expect(page1.items.map((i) => i.slug)).toEqual([
        "news-mar",
        "news-feb-late",
        "news-feb-early",
      ]);
      expect(page1.items[0]).not.toHaveProperty("body");

      const page2 = await listPublishedNews(ctx.db)({ page: 2, pageSize: 3 });
      expect(page2.total).toBe(4);
      expect(page2.items.map((i) => i.slug)).toEqual(["news-jan"]);
    });

    it("filters items by tag without narrowing the sidebar aggregates", async () => {
      const result = await listPublishedNews(ctx.db)({
        tag: "seniors",
        page: 1,
        pageSize: 5,
      });
      expect(result.total).toBe(2);
      expect(result.items.map((i) => i.slug)).toEqual([
        "news-feb-early",
        "news-jan",
      ]);
      // Counts span every published item even while ?tag narrows the
      // items - and the draft + scheduled 'seniors' items stay invisible.
      expect(result.tags).toEqual([
        { tag: "seniors", count: 2 },
        { tag: "social", count: 2 },
        { tag: "juniors", count: 1 },
      ]);
    });

    it("builds the archive and author count from published news only", async () => {
      const result = await listPublishedNews(ctx.db)({ page: 1, pageSize: 5 });
      expect(result.archive).toEqual([
        { month: "2026-03", count: 1 },
        { month: "2026-02", count: 2 },
        { month: "2026-01", count: 1 },
      ]);
      // alice-smith + bob-jones; the authorless item adds nothing and
      // carol-day only authors unpublished items.
      expect(result.authorCount).toBe(2);
    });

    it("lists published events in start order", async () => {
      const seedEvent = async (
        slug: string,
        when: string,
        publish: boolean,
      ) => {
        const { id } = await createContent(ctx.db)({
          kind: "event",
          slug,
          title: `Event ${slug}`,
          description: null,
          body: body(slug),
          metadata: {
            when,
            location: {
              name: "The Clubhouse",
              street: "St John's Terrace",
              city: "North Shields",
              postcode: "NE29 6HS",
            },
          },
          userId,
        });
        if (publish) await publishContent(ctx.db)({ contentId: id, userId });
      };
      // Mixed offsets: 18:00+01:00 is 17:00Z, so the bbq starts before the
      // quiz even though its 'when' string sorts after it lexically.
      await seedEvent("event-bbq", "2026-08-01T18:00:00+01:00", true);
      await seedEvent("event-quiz", "2026-08-01T17:30:00Z", true);
      await seedEvent("event-draft", "2026-07-01T10:00:00Z", false);

      const { items } = await listPublishedEvents(ctx.db)();
      expect(items.map((i) => i.slug)).toEqual(["event-bbq", "event-quiz"]);
      expect(items[0]?.metadata).toMatchObject({
        when: "2026-08-01T18:00:00+01:00",
        location: { postcode: "NE29 6HS" },
      });
      expect(items[0]).not.toHaveProperty("body");
    });
  });
});
