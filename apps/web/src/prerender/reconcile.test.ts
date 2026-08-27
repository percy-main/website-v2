import { describe, expect, it } from "vitest";
import {
  navHash,
  nextState,
  planReconcile,
  sitemapNeedsUpdate,
  type ManifestItem,
  type PrerenderState,
} from "./reconcile.js";

function item(
  url: string,
  overrides: Partial<ManifestItem> = {},
): ManifestItem {
  return {
    url,
    kind: "page",
    slug: url.split("/").pop() ?? "",
    updatedAt: "2026-06-01T10:00:00.000Z",
    publishedAt: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}

const NAV = [
  { path: "/club", title: "The Club", menuOrder: 1, isMainMenu: true },
];

function state(
  items: Record<
    string,
    { updatedAt: string; publishedAt: string; hash?: string }
  >,
  hash = navHash(NAV),
): PrerenderState {
  return { v: 1, navHash: hash, items };
}

describe("navHash", () => {
  it("is stable across item ordering", () => {
    const a = [
      { path: "/a", title: "A", menuOrder: 1, isMainMenu: true },
      { path: "/b", title: "B", menuOrder: 2, isMainMenu: false },
    ];
    expect(navHash(a)).toBe(navHash([...a].reverse()));
  });

  it("changes when a title, order or flag changes", () => {
    const base = [{ path: "/a", title: "A", menuOrder: 1, isMainMenu: true }];
    expect(navHash(base)).not.toBe(navHash([{ ...base[0], title: "A2" }]));
    expect(navHash(base)).not.toBe(navHash([{ ...base[0], menuOrder: 2 }]));
    expect(navHash(base)).not.toBe(
      navHash([{ ...base[0], isMainMenu: false }]),
    );
  });
});

describe("planReconcile", () => {
  it("renders everything on first run (no state)", () => {
    const manifest = [item("/club"), item("/news/article/x", { kind: "news" })];
    const plan = planReconcile({
      manifest,
      state: null,
      currentNavHash: navHash(NAV),
    });
    expect(plan.mode).toBe("initial");
    expect(plan.toRender).toEqual(manifest);
    expect(plan.toUnrender).toEqual([]);
  });

  it("renders only new and changed items on a steady-state diff", () => {
    const unchanged = item("/club");
    const edited = item("/club/history", {
      updatedAt: "2026-06-05T10:00:00.000Z",
    });
    const fresh = item("/news/article/new", { kind: "news" });
    const plan = planReconcile({
      manifest: [unchanged, edited, fresh],
      state: state({
        "/club": {
          updatedAt: unchanged.updatedAt,
          publishedAt: unchanged.publishedAt,
        },
        "/club/history": {
          updatedAt: "2026-06-01T10:00:00.000Z",
          publishedAt: edited.publishedAt,
        },
      }),
      currentNavHash: navHash(NAV),
    });
    expect(plan.mode).toBe("diff");
    expect(plan.toRender.map((i) => i.url)).toEqual([
      "/club/history",
      "/news/article/new",
    ]);
    expect(plan.toUnrender).toEqual([]);
  });

  it("detects a scheduled publish crossing go-live as a new item", () => {
    // Before go-live the manifest excludes the item entirely (the API
    // lists only live content), so at go-live it appears - a plain "new
    // item" to the diff.
    const scheduled = item("/news/article/matchday", { kind: "news" });
    const plan = planReconcile({
      manifest: [scheduled],
      state: state({}),
      currentNavHash: navHash(NAV),
    });
    expect(plan.toRender.map((i) => i.url)).toEqual(["/news/article/matchday"]);
  });

  it("tears down items that left the manifest", () => {
    const plan = planReconcile({
      manifest: [],
      state: state({
        "/person/gone": {
          updatedAt: "2026-06-01T10:00:00.000Z",
          publishedAt: "2026-06-01T10:00:00.000Z",
        },
      }),
      currentNavHash: navHash(NAV),
    });
    expect(plan.mode).toBe("diff");
    expect(plan.toRender).toEqual([]);
    expect(plan.toUnrender).toEqual(["/person/gone"]);
  });

  it("escalates to a full re-render when the nav changes", () => {
    const unchanged = item("/club");
    const plan = planReconcile({
      manifest: [unchanged],
      state: state(
        {
          "/club": {
            updatedAt: unchanged.updatedAt,
            publishedAt: unchanged.publishedAt,
          },
        },
        "stale-nav-hash",
      ),
      currentNavHash: navHash(NAV),
    });
    expect(plan.mode).toBe("nav-changed");
    expect(plan.toRender).toEqual([unchanged]);
  });

  it("force renders everything but still tears down vanished items", () => {
    const live = item("/club");
    const plan = planReconcile({
      manifest: [live],
      state: state({
        "/club": { updatedAt: live.updatedAt, publishedAt: live.publishedAt },
        "/person/gone": {
          updatedAt: "2026-06-01T10:00:00.000Z",
          publishedAt: "2026-06-01T10:00:00.000Z",
        },
      }),
      currentNavHash: navHash(NAV),
      force: true,
    });
    expect(plan.mode).toBe("forced");
    expect(plan.toRender).toEqual([live]);
    expect(plan.toUnrender).toEqual(["/person/gone"]);
  });
});

describe("nextState", () => {
  it("records the manifest minus failures so retries happen next sync", () => {
    const ok = item("/club");
    const failed = item("/club/history");
    const result = nextState(
      [ok, failed],
      "abc",
      "map1",
      new Set(["/club/history"]),
    );
    expect(Object.keys(result.items)).toEqual(["/club"]);
    expect(result.navHash).toBe("abc");
    expect(result.v).toBe(1);
  });

  it("persists the content hash when an item carries one", () => {
    const game = item("/calendar/game/123", { kind: "game", hash: "abc123" });
    const page = item("/club");
    const result = nextState([game, page], "nav", "map1");
    expect(result.items["/calendar/game/123"].hash).toBe("abc123");
    expect("hash" in result.items["/club"]).toBe(false);
  });

  it("persists the sitemap hash, omitting the key when there is none", () => {
    expect(nextState([], "nav", "map1").sitemapHash).toBe("map1");
    // A mid-sync flush before the rollout state exists carries undefined;
    // the key is left out entirely rather than written as null.
    expect("sitemapHash" in nextState([], "nav", undefined)).toBe(false);
  });
});

describe("sitemapNeedsUpdate", () => {
  it("skips a diff sweep whose sitemap is unchanged", () => {
    expect(sitemapNeedsUpdate("diff", "map1", "map1")).toBe(false);
  });

  it("updates on a diff sweep when the sitemap content changed", () => {
    expect(sitemapNeedsUpdate("diff", "map1", "map2")).toBe(true);
  });

  it("updates when the state file predates sitemap hashing", () => {
    expect(sitemapNeedsUpdate("diff", undefined, "map1")).toBe(true);
  });

  it("always updates in full-render modes, even on a hash match", () => {
    for (const mode of ["initial", "nav-changed", "forced"] as const) {
      expect(sitemapNeedsUpdate(mode, "map1", "map1")).toBe(true);
    }
  });
});

// Games and calendar months diff on an opaque content hash on top of the
// timestamps - their sources (match_result, sponsorships, matchday) carry
// no usable updated_at.
describe("hash-diffed items", () => {
  const TS = {
    updatedAt: "2026-06-01T10:00:00.000Z",
    publishedAt: "2026-06-01T10:00:00.000Z",
  };

  it("re-renders when only the hash changes", () => {
    const manifest = [
      item("/calendar/game/123", { kind: "game", hash: "after" }),
    ];
    const plan = planReconcile({
      manifest,
      state: state({ "/calendar/game/123": { ...TS, hash: "before" } }),
      currentNavHash: navHash(NAV),
    });
    expect(plan.mode).toBe("diff");
    expect(plan.toRender.map((entry) => entry.url)).toEqual([
      "/calendar/game/123",
    ]);
  });

  it("skips when timestamps and hash are unchanged", () => {
    const manifest = [
      item("/calendar/game/123", { kind: "game", hash: "same" }),
      item("/calendar/2026/july", { kind: "calendar-month", hash: "m1" }),
    ];
    const plan = planReconcile({
      manifest,
      state: state({
        "/calendar/game/123": { ...TS, hash: "same" },
        "/calendar/2026/july": { ...TS, hash: "m1" },
      }),
      currentNavHash: navHash(NAV),
    });
    expect(plan.toRender).toEqual([]);
  });

  it("re-renders a hashed item once against a pre-hash state entry", () => {
    const manifest = [
      item("/calendar/game/123", { kind: "game", hash: "new" }),
    ];
    const plan = planReconcile({
      manifest,
      // State written before hashes existed: no hash key.
      state: state({ "/calendar/game/123": { ...TS } }),
      currentNavHash: navHash(NAV),
    });
    expect(plan.toRender.map((entry) => entry.url)).toEqual([
      "/calendar/game/123",
    ]);
  });

  it("keeps pure-timestamp diffing for content items without hashes", () => {
    const manifest = [item("/club")];
    const plan = planReconcile({
      manifest,
      state: state({ "/club": { ...TS } }),
      currentNavHash: navHash(NAV),
    });
    expect(plan.toRender).toEqual([]);
  });
});
