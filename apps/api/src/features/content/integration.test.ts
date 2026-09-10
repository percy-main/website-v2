import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "../../lib/error-handler.ts";
import { buildTestApp } from "../../test/app.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { createTestLogger } from "../../test/logger.ts";
import { contentRoutes } from "./routes.ts";
import {
  archiveContent,
  createContent,
  getContent,
  getPublishedContent,
  getPublishedGameReport,
  getRevision,
  listContent,
  listPageTree,
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

    // Re-archiving is rejected, not a silent updated_at/updated_by bump
    await expect(
      archiveContent(ctx.db)({ contentId: id, userId }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Content is already archived",
    });
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

  it("serves a single revision in full for diff/restore (#500)", async () => {
    const { id } = await createContent(ctx.db)({
      kind: "game_report",
      slug: "rev-detail",
      title: "Rev detail",
      description: null,
      body: body("Original paragraph."),
      metadata: { playCricketId: "999111" },
      userId,
    });
    await updateContent(ctx.db)({
      contentId: id,
      title: "Rev detail v2",
      body: body("Edited paragraph."),
      userId,
    });

    const { revisions } = await listRevisions(ctx.db)(id);
    expect(revisions).toHaveLength(2);
    const creation = revisions[1];
    if (!creation) throw new Error("expected the creation revision");

    // The creation revision carries the full pre-edit state - exactly
    // what restore copies back into the editor.
    const detail = await getRevision(ctx.db)({
      contentId: id,
      revisionId: creation.id,
    });
    expect(detail.title).toBe("Rev detail");
    expect(detail.metadata).toEqual({ playCricketId: "999111" });
    expect(detail.body).toMatchObject([
      { content: [{ text: "Original paragraph." }] },
    ]);

    // A revision is only reachable under its own item's id - the route
    // gates permissions on the item's kind, so cross-item reads would
    // bypass the per-kind model.
    const other = await createContent(ctx.db)({
      kind: "game_report",
      slug: "rev-detail-other",
      title: "Other",
      description: null,
      body: body("Other."),
      metadata: { playCricketId: "999112" },
      userId,
    });
    await expect(
      getRevision(ctx.db)({ contentId: other.id, revisionId: creation.id }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      getRevision(ctx.db)({ contentId: id, revisionId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 404 });
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

    it("lists and serves published events across supported timestamp precisions", async () => {
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
      // Mixed offsets and precisions: 18:00+01:00 is 17:00Z, so the bbq
      // starts before the quiz even though its 'when' string sorts after it
      // lexically. Minute precision is used by the migrated production event
      // rows; seconds and fractional seconds remain part of the API contract.
      await seedEvent("event-bbq", "2026-08-01T18:00+01:00", true);
      await seedEvent("event-quiz", "2026-08-01T17:30:45Z", true);
      await seedEvent("event-awards", "2026-08-01T19:00:00.123+01:00", true);
      await seedEvent("event-draft", "2026-07-01T10:00:00Z", false);

      const { items } = await listPublishedEvents(ctx.db)();
      expect(items.map((i) => i.slug)).toEqual([
        "event-bbq",
        "event-quiz",
        "event-awards",
      ]);
      expect(items[0]?.metadata).toMatchObject({
        when: "2026-08-01T18:00+01:00",
        location: { postcode: "NE29 6HS" },
      });
      expect(items[0]).not.toHaveProperty("body");

      const detail = await getPublishedContent(ctx.db)({
        kind: "event",
        slug: "event-bbq",
      });
      expect(detail.metadata).toMatchObject({
        when: "2026-08-01T18:00+01:00",
        location: { postcode: "NE29 6HS" },
      });
    });
  });

  describe("scheduled publishing semantics", () => {
    const seedReport = async (slug: string, playCricketId: string) => {
      const { id } = await createContent(ctx.db)({
        kind: "game_report",
        slug,
        title: `Report ${slug}`,
        description: null,
        body: body(slug),
        metadata: { playCricketId },
        userId,
      });
      return id;
    };

    it("publish-now on a scheduled item goes live immediately", async () => {
      const id = await seedReport("sched-then-now", "990001");
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: future,
        userId,
      });
      await expect(
        getPublishedGameReport(ctx.db)("990001"),
      ).rejects.toMatchObject({ statusCode: 404 });

      // "Publish now" sends no date; the future schedule must not survive
      // the COALESCE-style trap and keep the item invisible.
      const result = await publishContent(ctx.db)({ contentId: id, userId });
      expect(result.publishedAt).not.toBe(future);
      expect(Date.parse(result.publishedAt ?? "")).toBeLessThanOrEqual(
        Date.now() + 5_000,
      );
      const pub = await getPublishedGameReport(ctx.db)("990001");
      expect(pub.id).toBe(id);
    });

    it("re-publish after unpublish keeps the original live-from date", async () => {
      const id = await seedReport("relive-original-date", "990002");
      const original = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: original,
        userId,
      });
      await unpublishContent(ctx.db)({ contentId: id, userId });

      const again = await publishContent(ctx.db)({ contentId: id, userId });
      expect(again.publishedAt).toBe(original);
    });

    it("cancelling a schedule clears published_at and unlocks the slug", async () => {
      const id = await seedReport("cancel-schedule", "990003");
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: future,
        userId,
      });
      await unpublishContent(ctx.db)({ contentId: id, userId });

      // Never publicly visible, so the ever-published marker is unset...
      const item = await getContent(ctx.db)(id);
      expect(item.status).toBe("draft");
      expect(item.publishedAt).toBeNull();

      // ...and the slug is editable again.
      await updateContent(ctx.db)({
        contentId: id,
        slug: "cancel-schedule-renamed",
        userId,
      });
      const renamed = await getContent(ctx.db)(id);
      expect(renamed.slug).toBe("cancel-schedule-renamed");
    });

    it("unpublishing a live item keeps published_at and the slug lock", async () => {
      const id = await seedReport("unpublish-live", "990004");
      const past = new Date(Date.now() - 1000).toISOString();
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: past,
        userId,
      });
      await unpublishContent(ctx.db)({ contentId: id, userId });

      const item = await getContent(ctx.db)(id);
      expect(item.status).toBe("draft");
      expect(item.publishedAt).toBe(past);

      await expect(
        updateContent(ctx.db)({ contentId: id, slug: "new-slug", userId }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("409s when scheduling an item that has already been live", async () => {
      const id = await seedReport("schedule-after-live", "990005");
      const past = new Date(Date.now() - 1000).toISOString();
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: past,
        userId,
      });

      // A future date on a live item would silently pull a page that WAS
      // public (and cancel-schedule would then unlock its slug).
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await expect(
        publishContent(ctx.db)({ contentId: id, publishedAt: future, userId }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          "This item has already been live - it can only be published immediately",
      });
      // The failed schedule must not have touched the row: still live.
      const pub = await getPublishedGameReport(ctx.db)("990005");
      expect(pub.publishedAt).toBe(past);

      // The unpublish-then-schedule chain is equally blocked: the
      // ever-live marker survives unpublish.
      await unpublishContent(ctx.db)({ contentId: id, userId });
      await expect(
        publishContent(ctx.db)({ contentId: id, publishedAt: future, userId }),
      ).rejects.toMatchObject({ statusCode: 409 });

      // ...while an explicit past date (idempotent re-publish /
      // migration-style backdating) still works.
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: past,
        userId,
      });
      expect((await getPublishedGameReport(ctx.db)("990005")).id).toBe(id);
    });

    it("change-schedule on a scheduled item still works (never live)", async () => {
      const id = await seedReport("change-schedule", "990006");
      const first = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: first,
        userId,
      });

      // Scheduled = future published_at = never live, so re-scheduling
      // (the dialog's "Change schedule") stays allowed.
      const second = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const result = await publishContent(ctx.db)({
        contentId: id,
        publishedAt: second,
        userId,
      });
      expect(result.publishedAt).toBe(second);
    });
  });

  describe("public visibility boundary (HTTP)", () => {
    // Minimal app: real routes over the container DB. Only the public
    // (no-auth) routes are exercised, so neither app.auth nor app.config
    // is needed.
    async function buildApp() {
      const logger = createTestLogger();
      const app = Fastify({ logger: { level: "info", stream: logger.stream } });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate("db", ctx.db);
      await app.register(contentRoutes);
      return app;
    }

    it("serves a scheduled news item the moment published_at passes - 404 (no ETag) before, 200 after", async () => {
      const { id } = await createContent(ctx.db)({
        kind: "news",
        slug: "boundary-news",
        title: "Boundary news",
        description: null,
        body: body("Crossing the line."),
        metadata: { tags: ["seniors"] },
        userId,
      });
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await publishContent(ctx.db)({
        contentId: id,
        publishedAt: future,
        userId,
      });

      const app = await buildApp();
      try {
        const before = await app.inject({
          method: "GET",
          url: "/content/news/boundary-news",
        });
        expect(before.statusCode).toBe(404);
        // The 404 path must never emit an ETag - a cached validator here
        // could pin "missing" past the publish time.
        expect(before.headers.etag).toBeUndefined();

        const listBefore = await app.inject({
          method: "GET",
          url: "/content/news",
        });
        expect(listBefore.statusCode).toBe(200);
        expect(
          listBefore
            .json<{ items: Array<{ slug: string }> }>()
            .items.map((i) => i.slug),
        ).not.toContain("boundary-news");

        // Move the schedule into the past by flipping the row directly:
        // visibility must follow from the DB clock comparison alone - no
        // deploy, no scheduler, no manual action.
        await ctx.db
          .updateTable("content_item")
          .set({ published_at: new Date(Date.now() - 1000) })
          .where("id", "=", id)
          .execute();

        const after = await app.inject({
          method: "GET",
          url: "/content/news/boundary-news",
        });
        expect(after.statusCode).toBe(200);
        expect(after.headers.etag).toBeDefined();
        expect(after.json<{ slug: string }>().slug).toBe("boundary-news");

        const listAfter = await app.inject({
          method: "GET",
          url: "/content/news",
        });
        expect(
          listAfter
            .json<{ items: Array<{ slug: string }> }>()
            .items.map((i) => i.slug),
        ).toContain("boundary-news");
      } finally {
        await app.close();
      }
    });
  });

  describe("person kind: lifecycle + safeguarding boundary (HTTP)", () => {
    // Person profiles carry safeguarding-adjacent flags, so they are
    // gated by content_people (people_editor / content_admin) instead of
    // the shared content roles (#498). The boundary is an acceptance
    // criterion in its own right, so this suite runs the REAL stack -
    // better-auth sessions, requireAuth, assertContentPermission - not
    // service calls.
    let app: Awaited<ReturnType<typeof buildTestApp>>;
    let peopleEditor: string;
    let newsEditor: string;
    let reportsEditor: string;
    let contentAdmin: string;
    /** Draft person owned by the service user - the read/write target. */
    let fixtureId: string;

    const PASSWORD = "Sup3rSecure!password";

    /** Sign up + verify + sign in; returns the session cookie header. */
    async function sessionFor(role: string): Promise<string> {
      const email = `${crypto.randomUUID()}@example.com`;
      const signUp = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: { email, password: PASSWORD, name: `Test ${role}` },
      });
      expect(signUp.statusCode).toBe(200);
      // Verified email + role set directly: this suite tests the content
      // permission boundary, not the verification email flow.
      await ctx.db
        .updateTable("user")
        .set({ role, emailVerified: true })
        .where("email", "=", email)
        .execute();
      const signIn = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        payload: { email, password: PASSWORD },
      });
      expect(signIn.statusCode).toBe(200);
      const setCookie = signIn.headers["set-cookie"];
      const raw = Array.isArray(setCookie)
        ? setCookie
        : typeof setCookie === "string"
          ? [setCookie]
          : [];
      const cookie = raw
        .map((entry) => entry.split(";")[0])
        .filter(Boolean)
        .join("; ");
      expect(cookie).not.toBe("");
      return cookie;
    }

    const personPayload = (slug: string) => ({
      kind: "person",
      slug,
      title: "Edith Example",
      description: null,
      body: body("A short bio."),
      metadata: { isDBSChecked: false, hasLeftClub: false },
    });

    beforeAll(async () => {
      app = await buildTestApp(ctx.db, ctx.dialect);
      [peopleEditor, newsEditor, reportsEditor, contentAdmin] =
        await Promise.all([
          sessionFor("people_editor"),
          sessionFor("news_editor"),
          sessionFor("reports_editor"),
          sessionFor("content_admin"),
        ]);
      ({ id: fixtureId } = await createContent(ctx.db)({
        kind: "person",
        slug: "boundary-fixture",
        title: "Boundary Fixture",
        description: null,
        body: body("Fixture bio."),
        metadata: {},
        userId,
      }));
    }, 120_000);

    afterAll(async () => {
      await app.close();
    });

    it("people_editor: create, edit the DBS flag, publish, public serve, revisions", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/admin/content",
        headers: { cookie: peopleEditor },
        payload: personPayload("edith-example"),
      });
      expect(create.statusCode).toBe(200);
      const { id } = create.json<{ id: string }>();

      const list = await app.inject({
        method: "GET",
        url: "/api/admin/content?kind=person",
        headers: { cookie: peopleEditor },
      });
      expect(list.statusCode).toBe(200);
      expect(
        list.json<{ items: Array<{ id: string }> }>().items.map((i) => i.id),
      ).toContain(id);

      // Draft profiles leak nothing publicly
      const draftPublic = await app.inject({
        method: "GET",
        url: "/api/content/person/edith-example",
      });
      expect(draftPublic.statusCode).toBe(404);

      // The safeguarding edit itself: toggle the DBS flag
      const update = await app.inject({
        method: "PUT",
        url: `/api/admin/content/${id}`,
        headers: { cookie: peopleEditor },
        payload: { metadata: { isDBSChecked: true, hasLeftClub: false } },
      });
      expect(update.statusCode).toBe(200);

      const publish = await app.inject({
        method: "POST",
        url: `/api/admin/content/${id}/publish`,
        headers: { cookie: peopleEditor },
        payload: {},
      });
      expect(publish.statusCode).toBe(200);

      // Public route serves the published profile (no auth) with the
      // projected metadata
      const pub = await app.inject({
        method: "GET",
        url: "/api/content/person/edith-example",
      });
      expect(pub.statusCode).toBe(200);
      const served = pub.json<{
        title: string;
        metadata: Record<string, unknown>;
      }>();
      expect(served.title).toBe("Edith Example");
      expect(served.metadata).toEqual({
        isDBSChecked: true,
        hasLeftClub: false,
      });

      // Both saves are in the revision history
      const revs = await app.inject({
        method: "GET",
        url: `/api/admin/content/${id}/revisions`,
        headers: { cookie: peopleEditor },
      });
      expect(revs.statusCode).toBe(200);
      const { revisions } = revs.json<{
        revisions: Array<{ id: string }>;
      }>();
      expect(revisions).toHaveLength(2);

      // The single-revision endpoint (#500) returns the full pre-edit
      // state for diff/restore - the creation revision still has the
      // DBS flag unticked.
      const creation = revisions[1];
      if (!creation) throw new Error("expected the creation revision");
      const detail = await app.inject({
        method: "GET",
        url: `/api/admin/content/${id}/revisions/${creation.id}`,
        headers: { cookie: peopleEditor },
      });
      expect(detail.statusCode).toBe(200);
      expect(
        detail.json<{ metadata: Record<string, unknown> }>().metadata,
      ).toEqual({ isDBSChecked: false, hasLeftClub: false });
    });

    it.each([
      ["news_editor", () => newsEditor],
      ["reports_editor", () => reportsEditor],
    ])(
      "%s can neither read nor write person content",
      async (_role, cookieOf) => {
        const cookie = cookieOf();
        const attempts = [
          app.inject({
            method: "GET",
            url: "/api/admin/content?kind=person",
            headers: { cookie },
          }),
          app.inject({
            method: "GET",
            url: `/api/admin/content/${fixtureId}`,
            headers: { cookie },
          }),
          app.inject({
            method: "POST",
            url: "/api/admin/content",
            headers: { cookie },
            payload: personPayload("smuggled-profile"),
          }),
          app.inject({
            method: "PUT",
            url: `/api/admin/content/${fixtureId}`,
            headers: { cookie },
            payload: { metadata: { isDBSChecked: true, hasLeftClub: false } },
          }),
          app.inject({
            method: "POST",
            url: `/api/admin/content/${fixtureId}/publish`,
            headers: { cookie },
            payload: {},
          }),
          app.inject({
            method: "POST",
            url: `/api/admin/content/${fixtureId}/archive`,
            headers: { cookie },
          }),
          app.inject({
            method: "GET",
            url: `/api/admin/content/${fixtureId}/revisions`,
            headers: { cookie },
          }),
          // Permission check precedes the revision lookup, so a random
          // revision id still proves the 403 boundary.
          app.inject({
            method: "GET",
            url: `/api/admin/content/${fixtureId}/revisions/${crypto.randomUUID()}`,
            headers: { cookie },
          }),
        ];
        for (const attempt of await Promise.all(attempts)) {
          expect(attempt.statusCode).toBe(403);
        }
        // And nothing was written or leaked
        const fixture = await getContent(ctx.db)(fixtureId);
        expect(fixture.metadata).toEqual({
          isDBSChecked: false,
          hasLeftClub: false,
        });
        expect(fixture.status).toBe("draft");
      },
    );

    it("the boundary cuts both ways: people_editor has no reach into other kinds", async () => {
      const newsList = await app.inject({
        method: "GET",
        url: "/api/admin/content?kind=news",
        headers: { cookie: peopleEditor },
      });
      expect(newsList.statusCode).toBe(403);

      const newsCreate = await app.inject({
        method: "POST",
        url: "/api/admin/content",
        headers: { cookie: peopleEditor },
        payload: {
          kind: "news",
          slug: "people-editor-news",
          title: "Not allowed",
          description: null,
          body: body("Nope."),
          metadata: { tags: [] },
        },
      });
      expect(newsCreate.statusCode).toBe(403);

      const reportsList = await app.inject({
        method: "GET",
        url: "/api/admin/content?kind=game_report",
        headers: { cookie: peopleEditor },
      });
      expect(reportsList.statusCode).toBe(403);
    });

    it("content_admin manages person content like any other kind", async () => {
      const list = await app.inject({
        method: "GET",
        url: "/api/admin/content?kind=person",
        headers: { cookie: contentAdmin },
      });
      expect(list.statusCode).toBe(200);

      const update = await app.inject({
        method: "PUT",
        url: `/api/admin/content/${fixtureId}`,
        headers: { cookie: contentAdmin },
        payload: { description: "Updated by the content admin" },
      });
      expect(update.statusCode).toBe(200);
    });

    it("anonymous admin requests are 401, not 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/content?kind=person",
      });
      expect(res.statusCode).toBe(401);
    });

    it("the public roster lists published people only, title-ordered", async () => {
      // One published (from the lifecycle test) + the draft fixture. Add
      // a second published person to assert ordering.
      const { id } = await createContent(ctx.db)({
        kind: "person",
        slug: "aaron-aardvark",
        title: "Aaron Aardvark",
        description: null,
        body: body("First alphabetically."),
        metadata: { isDBSChecked: false, hasLeftClub: true },
        userId,
      });
      await publishContent(ctx.db)({ contentId: id, userId });

      const res = await app.inject({
        method: "GET",
        url: "/api/content/people",
      });
      expect(res.statusCode).toBe(200);
      const { items } = res.json<{
        items: Array<{
          slug: string;
          title: string;
          metadata: Record<string, unknown>;
        }>;
      }>();
      const slugs = items.map((i) => i.slug);
      expect(slugs).toContain("aaron-aardvark");
      expect(slugs).toContain("edith-example");
      // The draft fixture stays out of the public roster
      expect(slugs).not.toContain("boundary-fixture");
      // Title-ordered
      expect(slugs.indexOf("aaron-aardvark")).toBeLessThan(
        slugs.indexOf("edith-example"),
      );
      // Metadata is projected through the person schema
      const aaron = items.find((i) => i.slug === "aaron-aardvark");
      expect(aaron?.metadata).toEqual({
        isDBSChecked: false,
        hasLeftClub: true,
      });
    });

    it("tombstones a taken-down profile: 410 by slug, listed in removed", async () => {
      // The SPA falls back to its bundled static profile on 404, so a
      // takedown (safeguarding-relevant for people) must not read as
      // "missing" - same rule as the page by-path tombstone.
      const { id } = await createContent(ctx.db)({
        kind: "person",
        slug: "tomb-person",
        title: "Tomb Person",
        description: null,
        body: body("Was live."),
        metadata: {},
        userId,
      });
      await publishContent(ctx.db)({ contentId: id, userId });
      await unpublishContent(ctx.db)({ contentId: id, userId });

      const bySlug = await app.inject({
        method: "GET",
        url: "/api/content/person/tomb-person",
      });
      expect(bySlug.statusCode).toBe(410);
      expect(bySlug.json()).toEqual({
        error: "This profile has been removed",
      });
      expect(bySlug.headers.etag).toBeUndefined();

      const roster = await app.inject({
        method: "GET",
        url: "/api/content/people",
      });
      const { items, removed } = roster.json<{
        items: Array<{ slug: string }>;
        removed: string[];
      }>();
      expect(removed).toContain("tomb-person");
      expect(items.map((i) => i.slug)).not.toContain("tomb-person");

      // Never-live drafts stay 404 and out of removed - they leak nothing
      const draft = await app.inject({
        method: "GET",
        url: "/api/content/person/boundary-fixture",
      });
      expect(draft.statusCode).toBe(404);
      expect(removed).not.toContain("boundary-fixture");
    });
  });

  describe("page hierarchy", () => {
    const mkPage = async (
      slug: string,
      opts: {
        parentId?: string | null;
        metadata?: Record<string, unknown>;
      } = {},
    ) => {
      const { id } = await createContent(ctx.db)({
        kind: "page",
        slug,
        title: `Page ${slug}`,
        description: null,
        body: body(slug),
        metadata: opts.metadata ?? {},
        parentId: opts.parentId ?? null,
        userId,
      });
      return id;
    };

    const pathOf = async (id: string) => (await getContent(ctx.db)(id)).path;

    it("computes materialised paths and cascades pre-publish renames and moves", async () => {
      const parent = await mkPage("cricket");
      const child = await mkPage("juniors", { parentId: parent });
      const grandchild = await mkPage("coaches", { parentId: child });

      expect(await pathOf(parent)).toBe("/cricket");
      expect(await pathOf(child)).toBe("/cricket/juniors");
      expect(await pathOf(grandchild)).toBe("/cricket/juniors/coaches");

      // Hierarchy fields surface in the admin detail/summary shape
      const detail = await getContent(ctx.db)(child);
      expect(detail.parentId).toBe(parent);
      expect(detail.menuOrder).toBe(99);

      // A pre-publish rename cascades through every descendant
      await updateContent(ctx.db)({
        contentId: parent,
        slug: "playing",
        userId,
      });
      expect(await pathOf(parent)).toBe("/playing");
      expect(await pathOf(child)).toBe("/playing/juniors");
      expect(await pathOf(grandchild)).toBe("/playing/juniors/coaches");

      // Reparent: move the grandchild up a level, then to the site root
      await updateContent(ctx.db)({
        contentId: grandchild,
        parentId: parent,
        userId,
      });
      expect(await pathOf(grandchild)).toBe("/playing/coaches");
      await updateContent(ctx.db)({
        contentId: grandchild,
        parentId: null,
        userId,
      });
      expect(await pathOf(grandchild)).toBe("/coaches");

      // Cycle prevention: self and descendant parents are rejected
      await expect(
        updateContent(ctx.db)({ contentId: parent, parentId: parent, userId }),
      ).rejects.toMatchObject({ statusCode: 400, message: /own parent/ });
      await expect(
        updateContent(ctx.db)({ contentId: parent, parentId: child, userId }),
      ).rejects.toMatchObject({ statusCode: 400, message: /descendant/ });

      // Sibling slug uniqueness: among one parent's children...
      await expect(
        mkPage("juniors", { parentId: parent }),
      ).rejects.toMatchObject({ statusCode: 409 });
      // ...and among root pages (the grandchild now owns /coaches)
      await expect(mkPage("coaches")).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it("rejects a parent on non-page kinds", async () => {
      await expect(
        createContent(ctx.db)({
          kind: "news",
          slug: "hierarchy-news",
          title: "Hierarchy news",
          description: null,
          body: body("No parents for news."),
          metadata: { tags: [] },
          parentId: crypto.randomUUID(),
          userId,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Only pages can have a parent page",
      });
    });

    it("publishes top-down, unpublishes bottom-up, and locks live paths", async () => {
      const parent = await mkPage("rules");
      const child = await mkPage("code-of-conduct", { parentId: parent });

      // Child first → blocked until the parent is published
      await expect(
        publishContent(ctx.db)({ contentId: child, userId }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Cannot publish this page until its parent page is published",
      });
      await publishContent(ctx.db)({ contentId: parent, userId });
      await publishContent(ctx.db)({ contentId: child, userId });

      // Both ever-published: slug AND parent are locked
      await expect(
        updateContent(ctx.db)({ contentId: parent, slug: "renamed", userId }),
      ).rejects.toMatchObject({ statusCode: 409, message: /locked/ });
      await expect(
        updateContent(ctx.db)({ contentId: child, parentId: null, userId }),
      ).rejects.toMatchObject({ statusCode: 409, message: /locked/ });

      // The parent cannot be unpublished over a live child
      await expect(
        unpublishContent(ctx.db)({ contentId: parent, userId }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: /published child pages/,
      });

      // Bottom-up works (also returns this test's pages to draft so the
      // nav test below can assert an exact payload)
      await unpublishContent(ctx.db)({ contentId: child, userId });
      await unpublishContent(ctx.db)({ contentId: parent, userId });
    });

    it("pins a draft ancestor's slug via an ever-published descendant", async () => {
      // Under the publish-ordering rules a descendant can only have gone
      // live if its ancestors did too, so a never-published ancestor
      // with an ever-published child needs the ancestor's own marker
      // cleared by hand (ops-level intervention; same direct-flip
      // technique as the visibility-boundary test). The descendant lock
      // is defense in depth for exactly such states.
      const parent = await mkPage("sections");
      const child = await mkPage("alpha", { parentId: parent });

      await publishContent(ctx.db)({ contentId: parent, userId });
      await publishContent(ctx.db)({ contentId: child, userId });
      await unpublishContent(ctx.db)({ contentId: child, userId });
      await unpublishContent(ctx.db)({ contentId: parent, userId });
      await ctx.db
        .updateTable("content_item")
        .set({ published_at: null })
        .where("id", "=", parent)
        .execute();

      // The parent's own ever-published marker is gone...
      expect((await getContent(ctx.db)(parent)).publishedAt).toBeNull();
      // ...but the ever-published child still pins its slug and parent.
      await expect(
        updateContent(ctx.db)({ contentId: parent, slug: "chapters", userId }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: /descendant page '\/sections\/alpha' has been published/,
      });
    });

    it("keeps a child's go-live at or after its parent's", async () => {
      const parent = await mkPage("season");
      const child = await mkPage("fixtures", { parentId: parent });
      const parentAt = new Date(Date.now() + 60 * 60 * 1000);
      await publishContent(ctx.db)({
        contentId: parent,
        publishedAt: parentAt.toISOString(),
        userId,
      });

      const tooEarly = `Parent page goes live at ${parentAt.toISOString()}; schedule this page for that time or later`;

      // Publish-now while the parent is still scheduled: the child would
      // be live on a URL prefix the public cannot see yet
      await expect(
        publishContent(ctx.db)({ contentId: child, userId }),
      ).rejects.toMatchObject({ statusCode: 400, message: tooEarly });

      // Scheduling before the parent's go-live is equally rejected...
      await expect(
        publishContent(ctx.db)({
          contentId: child,
          publishedAt: new Date(
            parentAt.getTime() - 30 * 60 * 1000,
          ).toISOString(),
          userId,
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: tooEarly });

      // ...as is backdating the child into the past
      await expect(
        publishContent(ctx.db)({
          contentId: child,
          publishedAt: new Date(Date.now() - 1000).toISOString(),
          userId,
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: tooEarly });

      // The parent's exact go-live instant works: a whole section can be
      // scheduled together, top-down
      const scheduled = await publishContent(ctx.db)({
        contentId: child,
        publishedAt: parentAt.toISOString(),
        userId,
      });
      expect(scheduled.publishedAt).toBe(parentAt.toISOString());

      // The mirror gate: re-scheduling the PARENT later than the child's
      // go-live would leave the child publicly live under a 404ing
      // parent between the two instants
      await expect(
        publishContent(ctx.db)({
          contentId: parent,
          publishedAt: new Date(
            parentAt.getTime() + 30 * 60 * 1000,
          ).toISOString(),
          userId,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message:
          "Children are scheduled before this go-live - reschedule them first",
      });

      // Re-scheduling the parent to the SAME instant stays allowed
      // (equal go-lives, the invariant the child gate permits)
      const reScheduled = await publishContent(ctx.db)({
        contentId: parent,
        publishedAt: parentAt.toISOString(),
        userId,
      });
      expect(reScheduled.publishedAt).toBe(parentAt.toISOString());

      // Unwind bottom-up (never live, so the markers clear and the nav
      // test below keeps its exact payload)
      await unpublishContent(ctx.db)({ contentId: child, userId });
      await unpublishContent(ctx.db)({ contentId: parent, userId });
    });

    it("archives a page only after its children are unpublished", async () => {
      const parent = await mkPage("vault");
      const child = await mkPage("records", { parentId: parent });
      await publishContent(ctx.db)({ contentId: parent, userId });
      await publishContent(ctx.db)({ contentId: child, userId });

      await expect(
        archiveContent(ctx.db)({ contentId: parent, userId }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: /published child pages/,
      });

      await unpublishContent(ctx.db)({ contentId: child, userId });
      // A draft child under an archived parent is acceptable...
      await archiveContent(ctx.db)({ contentId: parent, userId });
      expect((await getContent(ctx.db)(parent)).status).toBe("archived");
      // ...it just cannot be published (parent-not-published gate)
      await expect(
        publishContent(ctx.db)({ contentId: child, userId }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Cannot publish this page until its parent page is published",
      });
    });

    it("serves nav and page-by-path for exactly the published pages (HTTP)", async () => {
      const navA = await mkPage("nav-a", {
        metadata: { menuOrder: 1, isMainMenu: true },
      });
      const navB = await mkPage("nav-b", { parentId: navA });
      await mkPage("nav-draft");
      const navSched = await mkPage("nav-sched");

      await publishContent(ctx.db)({ contentId: navA, userId });
      await publishContent(ctx.db)({ contentId: navB, userId });
      await publishContent(ctx.db)({
        contentId: navSched,
        publishedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        userId,
      });

      // Root pages stay resolvable through the generic kind+slug route
      const rootBySlug = await getPublishedContent(ctx.db)({
        kind: "page",
        slug: "nav-a",
      });
      expect(rootBySlug.id).toBe(navA);

      const logger = createTestLogger();
      const app = Fastify({ logger: { level: "info", stream: logger.stream } });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      app.decorate("db", ctx.db);
      await app.register(contentRoutes);
      try {
        // Nav: exactly the live pages (no draft, no still-future
        // schedule), ordered by path, defaults applied from the schema.
        // removed[] lists every ever-live page no longer visible -
        // exactly the tombstones earlier tests in this describe minted
        // (unpublish-after-live and archive-after-live), path-ordered.
        const nav = await app.inject({ method: "GET", url: "/content/nav" });
        expect(nav.statusCode).toBe(200);
        expect(nav.json()).toEqual({
          items: [
            {
              path: "/nav-a",
              title: "Page nav-a",
              menuOrder: 1,
              isMainMenu: true,
            },
            {
              path: "/nav-a/nav-b",
              title: "Page nav-b",
              menuOrder: 99,
              isMainMenu: false,
            },
          ],
          removed: [
            "/rules",
            "/rules/code-of-conduct",
            "/sections/alpha",
            "/vault",
            "/vault/records",
          ],
        });

        // by-path serves the nested page with an ETag + 304 revalidation
        const byPath = await app.inject({
          method: "GET",
          url: "/content/page/by-path?path=/nav-a/nav-b",
        });
        expect(byPath.statusCode).toBe(200);
        expect(byPath.json<{ kind: string; slug: string }>()).toMatchObject({
          kind: "page",
          slug: "nav-b",
        });
        const etag = byPath.headers.etag;
        expect(etag).toBeDefined();
        const revalidated = await app.inject({
          method: "GET",
          url: "/content/page/by-path?path=/nav-a/nav-b",
          headers: { "if-none-match": etag ?? "" },
        });
        expect(revalidated.statusCode).toBe(304);

        // Drafts and scheduled pages 404 (and never leak an ETag)
        const draft = await app.inject({
          method: "GET",
          url: "/content/page/by-path?path=/nav-draft",
        });
        expect(draft.statusCode).toBe(404);
        expect(draft.headers.etag).toBeUndefined();
        const sched = await app.inject({
          method: "GET",
          url: "/content/page/by-path?path=/nav-sched",
        });
        expect(sched.statusCode).toBe(404);

        // Path shape is validated at the route: no leading slash → 400
        const bad = await app.inject({
          method: "GET",
          url: "/content/page/by-path?path=nav-a",
        });
        expect(bad.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it("lists every page for the admin tree: all statuses, path-ordered, lock and defaults derived", async () => {
      // Pages from earlier tests share the container, so assertions
      // filter to this test's own pages; path ordering is preserved
      // under filtering (a subsequence of an ordered list stays ordered).
      const root = await mkPage("tree-root", {
        metadata: { menuOrder: 2, isMainMenu: true },
      });
      const childBeta = await mkPage("beta", { parentId: root });
      const childAlpha = await mkPage("alpha", { parentId: root });
      const archived = await mkPage("tree-archived");
      await archiveContent(ctx.db)({ contentId: archived, userId });
      await publishContent(ctx.db)({ contentId: root, userId });

      const { items } = await listPageTree(ctx.db)();
      const mine = (id: string, list = items) => list.find((i) => i.id === id);
      const ids = new Set([root, childAlpha, childBeta, archived]);
      const ours = items.filter((i) => ids.has(i.id));

      // Ordered by path: ancestors before descendants, siblings lexicographic
      expect(ours.map((i) => i.path)).toEqual([
        "/tree-archived",
        "/tree-root",
        "/tree-root/alpha",
        "/tree-root/beta",
      ]);

      // Published root: explicit metadata surfaces, lock derived
      expect(mine(root)).toMatchObject({
        slug: "tree-root",
        parentId: null,
        status: "published",
        menuOrder: 2,
        isMainMenu: true,
        pathLocked: true,
      });
      expect(mine(root)?.publishedAt).not.toBeNull();

      // Draft child: schema defaults applied, no lock
      expect(mine(childAlpha)).toMatchObject({
        slug: "alpha",
        parentId: root,
        status: "draft",
        menuOrder: 99,
        isMainMenu: false,
        publishedAt: null,
        pathLocked: false,
      });

      // Archived pages stay in the tree (never published → unlocked)
      expect(mine(archived)).toMatchObject({
        status: "archived",
        pathLocked: false,
      });

      // Unpublish keeps the ever-published marker: still locked as draft
      await unpublishContent(ctx.db)({ contentId: root, userId });
      const after = await listPageTree(ctx.db)();
      expect(mine(root, after.items)).toMatchObject({
        status: "draft",
        pathLocked: true,
      });
    });

    it("rejects reserved root slugs but allows them on children", async () => {
      // The SPA router owns these first segments; a root page there
      // could never be reached past the router.
      await expect(mkPage("news")).rejects.toMatchObject({
        statusCode: 400,
        message: "This address is reserved by the site",
      });

      const parent = await mkPage("reserved-host");
      // Only the first path segment routes, so children may reuse them
      const child = await mkPage("news", { parentId: parent });
      expect((await getContent(ctx.db)(child)).path).toBe(
        "/reserved-host/news",
      );

      // Renaming a root page onto a reserved slug is equally blocked...
      await expect(
        updateContent(ctx.db)({ contentId: parent, slug: "admin", userId }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "This address is reserved by the site",
      });
      // ...as is moving a reserved-slugged child up to the root
      await expect(
        updateContent(ctx.db)({ contentId: child, parentId: null, userId }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "This address is reserved by the site",
      });
    });

    it("rejects creating or moving pages under an archived parent", async () => {
      const attic = await mkPage("attic");
      await archiveContent(ctx.db)({ contentId: attic, userId });

      await expect(mkPage("boxes", { parentId: attic })).rejects.toMatchObject({
        statusCode: 400,
        message: "Cannot create a page under an archived page",
      });

      const loft = await mkPage("loft");
      await expect(
        updateContent(ctx.db)({ contentId: loft, parentId: attic, userId }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Cannot move a page under an archived page",
      });
    });

    it("rejects computed paths that exceed the path schema bounds", async () => {
      // Four 200-char segments fit (804 chars); the fifth would push the
      // materialised path to 1005, past contentPathSchema's 1000 cap -
      // the same rule the by-path querystring validates, so a deeper
      // page could never be fetched.
      const segment = "x".repeat(200);
      let parentId: string | null = null;
      for (let depth = 0; depth < 4; depth++) {
        parentId = await mkPage(segment, { parentId });
      }
      await expect(mkPage(segment, { parentId })).rejects.toMatchObject({
        statusCode: 400,
        message: /too long or too deep/,
      });
    });

    it("tombstones taken-down pages: by-path 410 vs 404 matrix + nav removed[] (HTTP)", async () => {
      // The SPA falls back to bundled static MDX on 404, so a takedown
      // (unpublish/archive after going live) must be distinguishable
      // from "never existed" - 410, plus a nav removed[] entry to drop
      // resurrected static nav items.
      await mkPage("tomb-draft"); // created, never published
      const tombUnpub = await mkPage("tomb-unpub");
      const tombArch = await mkPage("tomb-arch");
      const tombSched = await mkPage("tomb-sched");

      await publishContent(ctx.db)({ contentId: tombUnpub, userId });
      await unpublishContent(ctx.db)({ contentId: tombUnpub, userId });
      await publishContent(ctx.db)({ contentId: tombArch, userId });
      await archiveContent(ctx.db)({ contentId: tombArch, userId });
      await publishContent(ctx.db)({
        contentId: tombSched,
        publishedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        userId,
      });

      const logger = createTestLogger();
      const app = Fastify({ logger: { level: "info", stream: logger.stream } });
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      // The production error handler, so the 410 body assertion below
      // exercises the real { error } contract, not Fastify's default.
      app.setErrorHandler(errorHandler);
      app.decorate("db", ctx.db);
      await app.register(contentRoutes);
      try {
        const get = (path: string) =>
          app.inject({
            method: "GET",
            url: `/content/page/by-path?path=${path}`,
          });

        // Never live: drafts and future schedules leak nothing - 404
        expect((await get("/tomb-draft")).statusCode).toBe(404);
        expect((await get("/tomb-sched")).statusCode).toBe(404);

        // Ever-live but taken down: 410 Gone with the documented body
        const unpub = await get("/tomb-unpub");
        expect(unpub.statusCode).toBe(410);
        expect(unpub.json()).toEqual({ error: "This page has been removed" });
        expect(unpub.headers.etag).toBeUndefined();
        expect((await get("/tomb-arch")).statusCode).toBe(410);

        // nav removed[]: exactly the ever-live-but-hidden paths (other
        // tests minted tombstones of their own, so containment only)
        const nav = await app
          .inject({ method: "GET", url: "/content/nav" })
          .then((res) => res.json<{ items: unknown[]; removed: string[] }>());
        expect(nav.removed).toContain("/tomb-unpub");
        expect(nav.removed).toContain("/tomb-arch");
        expect(nav.removed).not.toContain("/tomb-draft");
        expect(nav.removed).not.toContain("/tomb-sched");
      } finally {
        await app.close();
      }
    });
  });
});
