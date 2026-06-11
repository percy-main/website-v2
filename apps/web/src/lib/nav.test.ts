import { describe, expect, it } from "vitest";
import {
  getBreadcrumbs,
  getMainMenuItems,
  getNavigationTree,
  mergeNavPages,
  type NavPage,
} from "./nav";

function page(path: string, overrides: Partial<NavPage> = {}): NavPage {
  return {
    path,
    title: path.split("/").filter(Boolean).join(" "),
    menuOrder: 99,
    isMainMenu: false,
    ...overrides,
  };
}

// A static corpus mirroring the real content layout: a section root with
// ordered children and one grandchild level. Path-sorted, like
// content.ts's contentPages / staticNavPages.
const staticPages: NavPage[] = [
  page("/club", { title: "Club", isMainMenu: true, menuOrder: 1 }),
  page("/club/committee", { title: "Committee", menuOrder: 2 }),
  page("/club/history", { title: "History", menuOrder: 1 }),
  page("/club/history/honours", { title: "Honours", menuOrder: 1 }),
  page("/cricket", { title: "Cricket", isMainMenu: true, menuOrder: 2 }),
  page("/legal", { title: "Legal" }),
  page("/legal/privacy", { title: "Privacy Policy" }),
];

describe("mergeNavPages", () => {
  it("returns the static list unchanged when the API list is empty (pre-migration)", () => {
    expect(mergeNavPages([], staticPages)).toEqual(staticPages);
  });

  it("API page overrides the static page at the same path", () => {
    const merged = mergeNavPages(
      [page("/club", { title: "The Club", isMainMenu: true, menuOrder: 5 })],
      staticPages,
    );
    const club = merged.find((p) => p.path === "/club");
    expect(club).toEqual({
      path: "/club",
      title: "The Club",
      isMainMenu: true,
      menuOrder: 5,
    });
    // No duplicate entry for the shadowed static page
    expect(merged.filter((p) => p.path === "/club")).toHaveLength(1);
    expect(merged).toHaveLength(staticPages.length);
  });

  it("keeps static pages not shadowed by an API path", () => {
    const merged = mergeNavPages([page("/club")], staticPages);
    expect(merged.map((p) => p.path)).toContain("/legal/privacy");
    expect(merged.map((p) => p.path)).toContain("/club/history/honours");
  });

  it("sorts the merged list by path", () => {
    const merged = mergeNavPages(
      [page("/cricket/juniors"), page("/boxing")],
      staticPages,
    );
    expect(merged.map((p) => p.path)).toEqual(
      [...merged.map((p) => p.path)].sort((a, b) => a.localeCompare(b)),
    );
    expect(merged[0]?.path).toBe("/boxing");
  });
});

describe("getNavigationTree", () => {
  it("returns the section subtree for a nested current path", () => {
    const tree = getNavigationTree(staticPages, "/club/history/honours");
    expect(tree?.page.path).toBe("/club");
    expect(tree?.children.map((c) => c.page.path)).toEqual([
      "/club/history",
      "/club/committee",
    ]);
    expect(tree?.children[0]?.children.map((c) => c.page.path)).toEqual([
      "/club/history/honours",
    ]);
  });

  it("sorts children by menuOrder", () => {
    // History (menuOrder 1) before Committee (menuOrder 2) despite
    // "committee" sorting first by path.
    const tree = getNavigationTree(staticPages, "/club");
    expect(tree?.children.map((c) => c.page.title)).toEqual([
      "History",
      "Committee",
    ]);
  });

  it("breaks menuOrder ties by path order (stable sort)", () => {
    const tree = getNavigationTree(staticPages, "/legal");
    // Both legal children default to menuOrder 99... there is only one;
    // build a tie explicitly instead.
    expect(tree?.children).toHaveLength(1);

    const tied = [
      page("/a"),
      page("/a/x", { menuOrder: 5 }),
      page("/a/y", { menuOrder: 5 }),
    ];
    const tiedTree = getNavigationTree(tied, "/a");
    expect(tiedTree?.children.map((c) => c.page.path)).toEqual([
      "/a/x",
      "/a/y",
    ]);
  });

  it("returns null when the section root is not in the list", () => {
    expect(getNavigationTree(staticPages, "/news/some-article")).toBeNull();
  });

  it("returns null for the root path", () => {
    expect(getNavigationTree(staticPages, "/")).toBeNull();
  });

  it("includes DB pages merged into a static section", () => {
    const merged = mergeNavPages(
      [page("/club/grounds", { title: "Grounds", menuOrder: 0 })],
      staticPages,
    );
    const tree = getNavigationTree(merged, "/club");
    expect(tree?.children.map((c) => c.page.title)).toEqual([
      "Grounds",
      "History",
      "Committee",
    ]);
  });
});

describe("getBreadcrumbs", () => {
  it("walks ancestors from root to the current page", () => {
    expect(getBreadcrumbs(staticPages, "/club/history/honours")).toEqual([
      { title: "Club", path: "/club" },
      { title: "History", path: "/club/history" },
      { title: "Honours", path: "/club/history/honours" },
    ]);
  });

  it("skips ancestors missing from the merged list", () => {
    // A DB page can be published deeper than any published ancestor.
    const pages = [page("/club/teams/firsts", { title: "First XI" })];
    expect(getBreadcrumbs(pages, "/club/teams/firsts")).toEqual([
      { title: "First XI", path: "/club/teams/firsts" },
    ]);
  });

  it("returns known ancestors even when the current page is unknown", () => {
    expect(getBreadcrumbs(staticPages, "/club/history/missing")).toEqual([
      { title: "Club", path: "/club" },
      { title: "History", path: "/club/history" },
    ]);
  });

  it("returns an empty trail when nothing on the path is known", () => {
    expect(getBreadcrumbs(staticPages, "/nowhere/at/all")).toEqual([]);
  });
});

describe("getMainMenuItems", () => {
  it("filters to isMainMenu pages and sorts by menuOrder", () => {
    const items = getMainMenuItems([
      ...staticPages,
      page("/boxing", { title: "Boxing", isMainMenu: true, menuOrder: 0 }),
    ]);
    expect(items.map((p) => p.title)).toEqual(["Boxing", "Club", "Cricket"]);
  });

  it("returns an empty list when no page is flagged for the main menu", () => {
    expect(getMainMenuItems([page("/legal")])).toEqual([]);
  });

  it("lets a DB override pull a page out of the main menu", () => {
    const merged = mergeNavPages(
      [page("/cricket", { title: "Cricket", isMainMenu: false })],
      staticPages,
    );
    expect(getMainMenuItems(merged).map((p) => p.title)).toEqual(["Club"]);
  });
});
