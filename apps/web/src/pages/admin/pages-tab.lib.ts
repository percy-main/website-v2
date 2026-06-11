import type { paths } from "@/lib/api.gen.js";

// Pure tree/reorder logic for the admin Pages tab, kept DOM-free so it is
// unit-testable in plain vitest (same convention as the *-tab.reducer.ts
// and *-tab.lib.ts siblings).

/** One flat item from GET /api/admin/content/page-tree (OpenAPI-derived). */
export type PageTreeItem =
  paths["/api/admin/content/page-tree"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

export interface PageTreeNode {
  item: PageTreeItem;
  depth: number;
  children: PageTreeNode[];
}

/**
 * Sibling display order: menuOrder, then title, then path. The title
 * tie-break keeps groups of default-99 pages alphabetical instead of
 * insertion-ordered; path is the final total-order guarantee (titles can
 * collide, sibling paths cannot).
 */
function compareSiblings(a: PageTreeItem, b: PageTreeItem): number {
  if (a.menuOrder !== b.menuOrder) return a.menuOrder - b.menuOrder;
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.path.localeCompare(b.path);
}

/**
 * Assemble the flat page list into a forest. Orphans - items whose
 * parentId points at a page missing from the list (archived parent
 * filtered out upstream, or genuinely gone) - are promoted to root level
 * rather than silently disappearing from the admin view.
 */
export function buildPageTree(items: PageTreeItem[]): PageTreeNode[] {
  const known = new Set(items.map((item) => item.id));
  const childrenOf = new Map<string | null, PageTreeItem[]>();
  for (const item of items) {
    const key =
      item.parentId !== null && known.has(item.parentId) ? item.parentId : null;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(item);
    else childrenOf.set(key, [item]);
  }

  const build = (item: PageTreeItem, depth: number): PageTreeNode => ({
    item,
    depth,
    children: (childrenOf.get(item.id) ?? [])
      .toSorted(compareSiblings)
      .map((child) => build(child, depth + 1)),
  });

  return (childrenOf.get(null) ?? [])
    .toSorted(compareSiblings)
    .map((item) => build(item, 0));
}

/** Depth-first flatten of the subtrees whose parents are expanded. */
export function visibleNodes(
  nodes: PageTreeNode[],
  expanded: ReadonlySet<string>,
): PageTreeNode[] {
  const out: PageTreeNode[] = [];
  const walk = (node: PageTreeNode) => {
    out.push(node);
    if (expanded.has(node.item.id)) node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export interface MenuOrderUpdate {
  id: string;
  menuOrder: number;
}

/**
 * The metadata updates needed to move `id` one position up or down among
 * `siblings` (its display-ordered sibling group, the same order
 * buildPageTree produced). Returns [] when the move is impossible
 * (already at the edge, or not a sibling).
 *
 * When every sibling already has a distinct menuOrder, the two adjacent
 * pages simply swap values. Any duplicate (typically several pages
 * sharing the schema default 99) makes positions ambiguous, so the whole
 * sibling group is renumbered to spaced values (10, 20, 30...) in the
 * new order - one batch, deterministic ordering afterwards.
 */
export function reorderUpdates(
  siblings: PageTreeItem[],
  id: string,
  direction: "up" | "down",
): MenuOrderUpdate[] {
  const from = siblings.findIndex((item) => item.id === id);
  if (from === -1) return [];
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= siblings.length) return [];

  const orders = siblings.map((item) => item.menuOrder);
  const allDistinct = new Set(orders).size === orders.length;
  if (allDistinct) {
    return [
      { id: siblings[from].id, menuOrder: siblings[to].menuOrder },
      { id: siblings[to].id, menuOrder: siblings[from].menuOrder },
    ];
  }

  const reordered = [...siblings];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  // Spacing of 10 leaves room for manual insertion between neighbours;
  // fall back to 1 if a group is ever so large that 10s would breach the
  // schema's 999 cap.
  const spacing = reordered.length * 10 > 999 ? 1 : 10;
  const updates: MenuOrderUpdate[] = [];
  reordered.forEach((item, index) => {
    const menuOrder = (index + 1) * spacing;
    // Pages already sitting on their spaced value need no write.
    if (menuOrder !== item.menuOrder) updates.push({ id: item.id, menuOrder });
  });
  return updates;
}
