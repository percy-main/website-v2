import { describe, expect, it } from "vitest";
import {
  buildPageTree,
  eligibleParents,
  reorderUpdates,
  visibleNodes,
  type PageTreeItem,
} from "./pages-tab.lib.js";

function item(
  id: string,
  path: string,
  overrides: Partial<PageTreeItem> = {},
): PageTreeItem {
  return {
    id,
    title: id,
    slug: path.split("/").filter(Boolean).pop() ?? id,
    path,
    parentId: null,
    menuOrder: 99,
    isMainMenu: false,
    status: "draft",
    publishedAt: null,
    updatedAt: "2026-06-01T10:00:00.000Z",
    pathLocked: false,
    ...overrides,
  };
}

describe("buildPageTree", () => {
  it("nests children under parents with depths", () => {
    const tree = buildPageTree([
      item("club", "/club"),
      item("history", "/club/history", { parentId: "club" }),
      item("honours", "/club/history/honours", { parentId: "history" }),
      item("cricket", "/cricket"),
    ]);
    expect(tree.map((n) => n.item.id)).toEqual(["club", "cricket"]);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children.map((n) => n.item.id)).toEqual(["history"]);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children.map((n) => n.item.id)).toEqual([
      "honours",
    ]);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it("promotes orphans (parent missing from the list) to root level", () => {
    const tree = buildPageTree([
      item("club", "/club"),
      // Parent archived/missing - must not disappear from the admin view
      item("lost", "/gone/lost", { parentId: "gone" }),
    ]);
    expect(tree.map((n) => n.item.id).toSorted()).toEqual(["club", "lost"]);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
  });

  it("sorts siblings by menuOrder, then title, then path", () => {
    const tree = buildPageTree([
      item("zeta", "/zeta", { menuOrder: 1, title: "Zeta" }),
      item("beta", "/beta", { menuOrder: 5, title: "Same" }),
      item("alpha", "/alpha", { menuOrder: 5, title: "Same" }),
      item("mid", "/mid", { menuOrder: 2, title: "Mid" }),
    ]);
    // menuOrder wins; the equal-99 default pair falls to title (equal
    // here) and then path
    expect(tree.map((n) => n.item.id)).toEqual([
      "zeta",
      "mid",
      "alpha",
      "beta",
    ]);
  });

  it("returns an empty forest for no pages", () => {
    expect(buildPageTree([])).toEqual([]);
  });
});

describe("eligibleParents", () => {
  const items = [
    item("club", "/club", { status: "published" }),
    item("history", "/club/history", {
      parentId: "club",
      status: "published",
    }),
    item("honours", "/club/history/honours", {
      parentId: "history",
      status: "published",
    }),
    item("old", "/old", { status: "archived" }),
    item("scratch", "/scratch", { status: "draft" }),
  ];

  it("excludes the page itself and its descendants", () => {
    expect(eligibleParents(items, "history", null).map((i) => i.id)).toEqual([
      "club",
      "scratch",
    ]);
  });

  it("excludes archived pages (the backend rejects them as parents)", () => {
    expect(eligibleParents(items, null, null).map((i) => i.id)).toEqual([
      "club",
      "history",
      "honours",
      "scratch",
    ]);
  });

  it("keeps the currently-selected parent even when archived", () => {
    // An existing child of a since-archived parent: the Select must not
    // go blank, so the archived parent stays (annotated in the picker).
    expect(eligibleParents(items, "scratch", "old").map((i) => i.id)).toEqual([
      "club",
      "history",
      "honours",
      "old",
    ]);
  });

  it("does not resurrect other archived pages for a selected parent", () => {
    const withSecondArchived = [
      ...items,
      item("older", "/older", { status: "archived" }),
    ];
    const ids = eligibleParents(withSecondArchived, "scratch", "old").map(
      (i) => i.id,
    );
    expect(ids).toContain("old");
    expect(ids).not.toContain("older");
  });

  it("offers everything but archived when creating (itemId null)", () => {
    expect(eligibleParents(items, null, null)).toHaveLength(4);
  });
});

describe("visibleNodes", () => {
  const tree = buildPageTree([
    item("club", "/club"),
    item("history", "/club/history", { parentId: "club" }),
    item("honours", "/club/history/honours", { parentId: "history" }),
    item("cricket", "/cricket"),
  ]);

  it("shows only roots when nothing is expanded", () => {
    expect(visibleNodes(tree, new Set()).map((n) => n.item.id)).toEqual([
      "club",
      "cricket",
    ]);
  });

  it("reveals children of expanded nodes only, depth-first", () => {
    expect(visibleNodes(tree, new Set(["club"])).map((n) => n.item.id)).toEqual(
      ["club", "history", "cricket"],
    );
    expect(
      visibleNodes(tree, new Set(["club", "history"])).map((n) => n.item.id),
    ).toEqual(["club", "history", "honours", "cricket"]);
  });

  it("ignores expansion of a collapsed ancestor's descendants", () => {
    // history is expanded but club is not - honours stays hidden
    expect(
      visibleNodes(tree, new Set(["history"])).map((n) => n.item.id),
    ).toEqual(["club", "cricket"]);
  });
});

describe("reorderUpdates", () => {
  it("swaps the two adjacent pages when every menuOrder is distinct", () => {
    const siblings = [
      item("a", "/a", { menuOrder: 1 }),
      item("b", "/b", { menuOrder: 5 }),
      item("c", "/c", { menuOrder: 9 }),
    ];
    expect(reorderUpdates(siblings, "b", "up")).toEqual([
      { id: "b", menuOrder: 1 },
      { id: "a", menuOrder: 5 },
    ]);
    expect(reorderUpdates(siblings, "b", "down")).toEqual([
      { id: "b", menuOrder: 9 },
      { id: "c", menuOrder: 5 },
    ]);
  });

  it("renumbers the whole group to spaced values when defaults collide", () => {
    const siblings = [
      item("a", "/a", { menuOrder: 99 }),
      item("b", "/b", { menuOrder: 99 }),
      item("c", "/c", { menuOrder: 99 }),
    ];
    // b moves up: new order is b, a, c at 10/20/30
    expect(reorderUpdates(siblings, "b", "up")).toEqual([
      { id: "b", menuOrder: 10 },
      { id: "a", menuOrder: 20 },
      { id: "c", menuOrder: 30 },
    ]);
  });

  it("only emits updates for pages whose menuOrder actually changes", () => {
    const siblings = [
      item("a", "/a", { menuOrder: 10 }),
      item("b", "/b", { menuOrder: 99 }),
      item("c", "/c", { menuOrder: 99 }),
    ];
    // c moves up: renumber path (duplicates exist); a already sits at 10
    expect(reorderUpdates(siblings, "c", "up")).toEqual([
      { id: "c", menuOrder: 20 },
      { id: "b", menuOrder: 30 },
    ]);
  });

  it("is a no-op at the edges and for unknown ids", () => {
    const siblings = [
      item("a", "/a", { menuOrder: 1 }),
      item("b", "/b", { menuOrder: 2 }),
    ];
    expect(reorderUpdates(siblings, "a", "up")).toEqual([]);
    expect(reorderUpdates(siblings, "b", "down")).toEqual([]);
    expect(reorderUpdates(siblings, "missing", "up")).toEqual([]);
    expect(reorderUpdates([], "a", "up")).toEqual([]);
  });

  it("keeps renumbered values inside the schema cap for huge groups", () => {
    const siblings = Array.from({ length: 120 }, (_, i) =>
      item(`p${String(i)}`, `/p${String(i)}`, { menuOrder: 99 }),
    );
    const updates = reorderUpdates(siblings, "p1", "up");
    expect(updates.length).toBeGreaterThan(0);
    expect(Math.max(...updates.map((u) => u.menuOrder))).toBeLessThanOrEqual(
      999,
    );
  });
});
