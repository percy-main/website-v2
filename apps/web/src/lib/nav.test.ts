import { describe, expect, it } from "vitest";
import {
  getBreadcrumbs,
  getMainMenuItems,
  getNavigationTree,
  sortNavPages,
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

// A corpus mirroring the real content layout: a section root with
// ordered children and one grandchild level. Path-sorted, as
// useSiteNav always feeds the tree builders.
const navPages: NavPage[] = [
  page("/club", { title: "Club", isMainMenu: true, menuOrder: 1 }),
  page("/club/committee", { title: "Committee", menuOrder: 2 }),
  page("/club/history", { title: "History", menuOrder: 1 }),
  page("/club/history/honours", { title: "Honours", menuOrder: 1 }),
  page("/cricket", { title: "Cricket", isMainMenu: true, menuOrder: 2 }),
  page("/legal", { title: "Legal" }),
  page("/legal/privacy", { title: "Privacy Policy" }),
];

describe("sortNavPages", () => {
  it("sorts pages by path", () => {
    const sorted = sortNavPages([
      page("/cricket/juniors"),
      page("/boxing"),
      page("/cricket"),
    ]);
    expect(sorted.map((p) => p.path)).toEqual([
      "/boxing",
      "/cricket",
      "/cricket/juniors",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [page("/b"), page("/a")];
    sortNavPages(input);
    expect(input.map((p) => p.path)).toEqual(["/b", "/a"]);
  });
});

describe("getNavigationTree", () => {
  it("returns the section subtree for a nested current path", () => {
    const tree = getNavigationTree(navPages, "/club/history/honours");
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
    const tree = getNavigationTree(navPages, "/club");
    expect(tree?.children.map((c) => c.page.title)).toEqual([
      "History",
      "Committee",
    ]);
  });

  it("breaks menuOrder ties by path order (stable sort)", () => {
    const tree = getNavigationTree(navPages, "/legal");
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
    expect(getNavigationTree(navPages, "/news/some-article")).toBeNull();
  });

  it("returns null for the root path", () => {
    expect(getNavigationTree(navPages, "/")).toBeNull();
  });
});

describe("getBreadcrumbs", () => {
  it("walks ancestors from root to the current page", () => {
    expect(getBreadcrumbs(navPages, "/club/history/honours")).toEqual([
      { title: "Club", path: "/club" },
      { title: "History", path: "/club/history" },
      { title: "Honours", path: "/club/history/honours" },
    ]);
  });

  it("skips ancestors missing from the list", () => {
    // A page can be published deeper than any published ancestor.
    const pages = [page("/club/teams/firsts", { title: "First XI" })];
    expect(getBreadcrumbs(pages, "/club/teams/firsts")).toEqual([
      { title: "First XI", path: "/club/teams/firsts" },
    ]);
  });

  it("returns known ancestors even when the current page is unknown", () => {
    expect(getBreadcrumbs(navPages, "/club/history/missing")).toEqual([
      { title: "Club", path: "/club" },
      { title: "History", path: "/club/history" },
    ]);
  });

  it("returns an empty trail when nothing on the path is known", () => {
    expect(getBreadcrumbs(navPages, "/nowhere/at/all")).toEqual([]);
  });
});

describe("getMainMenuItems", () => {
  it("filters to isMainMenu pages and sorts by menuOrder", () => {
    const items = getMainMenuItems([
      ...navPages,
      page("/boxing", { title: "Boxing", isMainMenu: true, menuOrder: 0 }),
    ]);
    expect(items.map((p) => p.title)).toEqual(["Boxing", "Club", "Cricket"]);
  });

  it("returns an empty list when no page is flagged for the main menu", () => {
    expect(getMainMenuItems([page("/legal")])).toEqual([]);
  });
});
