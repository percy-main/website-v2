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

    // Archive blocks re-publish
    await archiveContent(ctx.db)({ contentId: id, userId });
    await expect(
      publishContent(ctx.db)({ contentId: id, userId }),
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
});
