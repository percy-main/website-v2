import type { FastifyBaseLogger } from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { stubSocialMediaUploader } from "../../lib/s3-social-media.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import type { LlmClient } from "./caption.ts";
import type { MetaClient } from "./meta-client.ts";
import {
  claimPublication,
  listPublications,
  publishTeamSheet,
  reconcilePublication,
  retryPublication,
} from "./service.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

const silentLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

const captionStub: LlmClient = {
  generateCaption: vi
    .fn()
    .mockResolvedValue("Team sheet ready. Good luck lads."),
};

function makeMetaStub(overrides: Partial<MetaClient> = {}): MetaClient {
  return {
    postToFacebook: vi
      .fn()
      .mockResolvedValue({ externalPostId: "fb-" + crypto.randomUUID() }),
    postToInstagram: vi
      .fn()
      .mockResolvedValue({ externalPostId: "ig-" + crypto.randomUUID() }),
    ...overrides,
  };
}

async function seedTeam() {
  const id = `pct-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("play_cricket_team")
    .values({ id, name: `Team ${id.slice(0, 6)}`, site_id: "site-1" })
    .execute();
  return id;
}

async function seedConfirmedMatchday(teamId: string, createdBy: string) {
  const id = `md-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("matchday")
    .values({
      id,
      play_cricket_team_id: teamId,
      match_date: "2026-06-15",
      opposition: "Benwell Hill CC",
      created_by: createdBy,
      status: "confirmed",
    })
    .execute();

  const playerId = `mp-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("matchday_player")
    .values({
      id: playerId,
      matchday_id: id,
      member_id: null,
      player_name: "Alex Young",
      status: "playing",
    })
    .execute();

  return id;
}

function makeDeps(overrides: { meta?: MetaClient; enabled?: boolean } = {}) {
  return {
    db: ctx.db,
    llm: captionStub,
    meta: overrides.meta ?? makeMetaStub(),
    s3Social: stubSocialMediaUploader,
    log: silentLog,
    enabled: overrides.enabled ?? true,
  };
}

describe("social-posting service (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (captionStub.generateCaption as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Team sheet ready. Good luck lads.",
    );
  });

  it("publishes both platforms on happy path", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-happy-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    const meta = makeMetaStub();
    const result = await publishTeamSheet(makeDeps({ meta }))({
      matchdayId,
      userId,
      role: "admin",
      isHome: true,
      matchTime: "13:00",
    });

    expect(result).not.toHaveProperty("skipped");
    if ("skipped" in result) throw new Error("unexpected skip");
    expect(result.facebook.state).toBe("posted");
    expect(result.instagram.state).toBe("posted");
    expect(meta.postToFacebook).toHaveBeenCalledTimes(1);
    expect(meta.postToInstagram).toHaveBeenCalledTimes(1);

    const rows = await listPublications(ctx.db)(matchdayId);
    expect(rows.items).toHaveLength(2);
    for (const row of rows.items) {
      expect(row.state).toBe("posted");
      expect(row.external_post_id).toBeTruthy();
    }
  });

  it("is idempotent — calling publishTeamSheet twice does not repost", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-idem-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    const meta = makeMetaStub();
    const deps = makeDeps({ meta });
    await publishTeamSheet(deps)({
      matchdayId,
      userId,
      role: "admin",
      isHome: true,
      matchTime: null,
    });

    const second = await publishTeamSheet(deps)({
      matchdayId,
      userId,
      role: "admin",
      isHome: true,
      matchTime: null,
    });

    if ("skipped" in second) throw new Error("unexpected skip");
    expect(second.facebook.state).toBe("already_posted");
    expect(second.instagram.state).toBe("already_posted");
    expect(meta.postToFacebook).toHaveBeenCalledTimes(1);
    expect(meta.postToInstagram).toHaveBeenCalledTimes(1);

    const rows = await listPublications(ctx.db)(matchdayId);
    expect(rows.items).toHaveLength(2);
  });

  it("serialises concurrent claims via the unique constraint", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-conc-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    const meta = makeMetaStub();
    const deps = makeDeps({ meta });

    const [a, b] = await Promise.all([
      publishTeamSheet(deps)({
        matchdayId,
        userId,
        role: "admin",
        isHome: true,
        matchTime: null,
      }),
      publishTeamSheet(deps)({
        matchdayId,
        userId,
        role: "admin",
        isHome: true,
        matchTime: null,
      }),
    ]);

    if ("skipped" in a || "skipped" in b) throw new Error("unexpected skip");

    // Across the two concurrent calls, each platform should have been called
    // exactly once on the Meta client.
    expect(meta.postToFacebook).toHaveBeenCalledTimes(1);
    expect(meta.postToInstagram).toHaveBeenCalledTimes(1);

    const rows = await listPublications(ctx.db)(matchdayId);
    expect(rows.items).toHaveLength(2);
    for (const row of rows.items) {
      expect(row.state).toBe("posted");
    }
  });

  it("partial success + platform-specific retry does not re-post the good platform", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-partial-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    let igCalls = 0;
    const meta = makeMetaStub({
      postToInstagram: vi.fn(() => {
        igCalls++;
        if (igCalls === 1) return Promise.reject(new Error("IG blew up"));
        return Promise.resolve({
          externalPostId: `ig-${crypto.randomUUID()}`,
        });
      }),
    });

    const deps = makeDeps({ meta });
    const first = await publishTeamSheet(deps)({
      matchdayId,
      userId,
      role: "admin",
      isHome: true,
      matchTime: null,
    });

    if ("skipped" in first) throw new Error("unexpected skip");
    expect(first.facebook.state).toBe("posted");
    expect(first.instagram.state).toBe("failed");

    const retry = await retryPublication(deps)({
      matchdayId,
      platform: "instagram",
      userId,
      role: "admin",
      isHome: true,
      matchTime: null,
    });

    expect(retry.state).toBe("posted");
    expect(meta.postToFacebook).toHaveBeenCalledTimes(1); // never called again
    expect(meta.postToInstagram).toHaveBeenCalledTimes(2);
  });

  it("reconcile marks a stuck claimed row as posted with the supplied external ID", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-rec-posted-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    const claim = await claimPublication(ctx.db, {
      matchdayId,
      platform: "facebook",
      caption: "stub",
      captionSource: "fallback",
      captionVersion: "v1",
      imageUrl: "https://example/test.png",
    });
    expect(claim.status).toBe("claimed");

    const result = await reconcilePublication(ctx.db)({
      matchdayId,
      platform: "facebook",
      outcome: "posted",
      externalPostId: "fb-verified-123",
    });
    expect(result.state).toBe("posted");

    const rows = await listPublications(ctx.db)(matchdayId);
    const fb = rows.items.find((r) => r.platform === "facebook");
    expect(fb?.state).toBe("posted");
    expect(fb?.external_post_id).toBe("fb-verified-123");
  });

  it("reconcile marks a stuck claimed row as failed, unblocking retry", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-rec-failed-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    await claimPublication(ctx.db, {
      matchdayId,
      platform: "instagram",
      caption: "stub",
      captionSource: "fallback",
      captionVersion: "v1",
      imageUrl: "https://example/test.png",
    });

    await reconcilePublication(ctx.db)({
      matchdayId,
      platform: "instagram",
      outcome: "failed",
    });

    const meta = makeMetaStub();
    const retry = await retryPublication(makeDeps({ meta }))({
      matchdayId,
      platform: "instagram",
      userId,
      role: "admin",
      isHome: true,
      matchTime: null,
    });
    expect(retry.state).toBe("posted");
  });

  it("disabled flag short-circuits and inserts zero rows", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-off-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    const meta = makeMetaStub();
    const result = await publishTeamSheet(makeDeps({ meta, enabled: false }))({
      matchdayId,
      userId,
      role: "admin",
      isHome: true,
      matchTime: null,
    });

    expect(result).toEqual({ skipped: "feature disabled" });
    expect(meta.postToFacebook).not.toHaveBeenCalled();
    expect(meta.postToInstagram).not.toHaveBeenCalled();

    const rows = await listPublications(ctx.db)(matchdayId);
    expect(rows.items).toHaveLength(0);
  });

  it("DB rejects state=posted rows without an external_post_id", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      email: `sp-constraint-${crypto.randomUUID()}@test.com`,
      role: "admin",
    });
    const teamId = await seedTeam();
    const matchdayId = await seedConfirmedMatchday(teamId, userId);

    await claimPublication(ctx.db, {
      matchdayId,
      platform: "facebook",
      caption: "stub",
      captionSource: "fallback",
      captionVersion: "v1",
      imageUrl: "https://example/test.png",
    });

    await expect(
      ctx.db
        .updateTable("matchday_social_publication")
        .set({ state: "posted" })
        .where("matchday_id", "=", matchdayId)
        .where("platform", "=", "facebook")
        .execute(),
    ).rejects.toThrow(/matchday_social_publication_posted_complete/);
  });
});
