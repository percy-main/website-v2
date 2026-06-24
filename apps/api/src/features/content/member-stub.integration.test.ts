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
  getPublishedContent,
  publishContent,
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

// Member-backed fallback profile (#...). Slugs are backfilled across all
// members, so a member can own a profile slug before anyone has authored
// the profile page. getPublishedContent serves a minimal stub for such a
// slug (so a leaderboard link never dead-ends), but ONLY when no real
// page/tombstone applies and the member is live.
describe("getPublishedContent member-backed person fallback (integration)", () => {
  let ctx: TestContext;
  let userId: string;

  async function linkMember(
    slug: string,
    name: string,
    opts: { deleted?: boolean } = {},
  ) {
    const member = await seedTestUser(ctx.db, { withMember: true, name });
    if (!member.memberId) throw new Error("seedTestUser made no member");
    await ctx.db
      .updateTable("member")
      .set({
        slug,
        ...(opts.deleted ? { deleted_at: new Date().toISOString() } : {}),
      })
      .where("id", "=", member.memberId)
      .execute();
    return member;
  }

  beforeAll(async () => {
    ctx = await startTestContainer();
    ({ userId } = await seedTestUser(ctx.db, { withMember: false }));
  }, 120_000);

  afterAll(async () => {
    await stopTestContainer(ctx);
  });

  it("serves a stub for a slug-linked member with no profile page yet", async () => {
    await linkMember("fallback-fred", "Fallback Fred");

    const result = await getPublishedContent(ctx.db)({
      kind: "person",
      slug: "fallback-fred",
    });

    expect(result.kind).toBe("person");
    expect(result.slug).toBe("fallback-fred");
    expect(result.title).toBe("Fallback Fred");
    expect(result.body).toEqual([]);
    expect(result.id).toBe("member-stub:fallback-fred");
    // Stubs never claim a DBS badge (the flag is admin-set on a real page).
    expect(result.metadata).toMatchObject({ isDBSChecked: false });
  });

  it("404s for an unknown slug with no member and no page", async () => {
    await expect(
      getPublishedContent(ctx.db)({ kind: "person", slug: "nobody-here" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not serve a stub for a soft-deleted member", async () => {
    await linkMember("gone-gary", "Gone Gary", { deleted: true });

    await expect(
      getPublishedContent(ctx.db)({ kind: "person", slug: "gone-gary" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("prefers a real published page over the member stub", async () => {
    await linkMember("real-rita", "Rita Member");
    const { id } = await createContent(ctx.db)({
      kind: "person",
      slug: "real-rita",
      title: "Rita Published",
      description: null,
      body: body("A proper bio"),
      metadata: { isDBSChecked: true, hasLeftClub: false },
      userId,
    });
    await publishContent(ctx.db)({ contentId: id, userId });

    const result = await getPublishedContent(ctx.db)({
      kind: "person",
      slug: "real-rita",
    });

    expect(result.id).toBe(id);
    expect(result.title).toBe("Rita Published");
    expect(result.metadata).toMatchObject({ isDBSChecked: true });
  });

  it("keeps a tombstone (410) ahead of the member stub - a takedown is never resurrected", async () => {
    await linkMember("taken-down-tom", "Tom Member");
    const { id } = await createContent(ctx.db)({
      kind: "person",
      slug: "taken-down-tom",
      title: "Tom Published",
      description: null,
      body: body("Was live"),
      metadata: { isDBSChecked: false, hasLeftClub: false },
      userId,
    });
    await publishContent(ctx.db)({ contentId: id, userId });
    await archiveContent(ctx.db)({ contentId: id, userId });

    await expect(
      getPublishedContent(ctx.db)({ kind: "person", slug: "taken-down-tom" }),
    ).rejects.toMatchObject({ statusCode: 410 });
  });
});
