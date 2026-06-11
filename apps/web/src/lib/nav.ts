// Pure nav-model functions for the merged page hierarchy (#493): DB-backed
// pages from GET /api/content/nav plus the bundled static MDX pages. Kept
// free of Vite-only dependencies (content.ts needs import.meta.glob) so
// the tree/breadcrumb/menu logic is unit-testable in plain vitest.

/**
 * Lightweight nav shape shared by API nav items and static content pages.
 * Nav trees, breadcrumbs and menus only need these fields - only the page
 * renderer needs the full static ContentPage (with its Component).
 */
export interface NavPage {
  /** URL path, e.g. "/club/history/honours" */
  path: string;
  title: string;
  menuOrder: number;
  isMainMenu: boolean;
}

export interface NavNode {
  page: NavPage;
  children: NavNode[];
}

/**
 * Merge API nav items with the static page list. The API wins on a path
 * collision (a migrated page's DB title/menu placement replaces its
 * bundled MDX ancestor); static pages without a DB counterpart pass
 * through unchanged, so sections migrate one at a time. The result is
 * sorted by path, mirroring the static pipeline's contentPages ordering -
 * with an empty API list (pre-migration) the output is identical to the
 * old static-only list.
 *
 * `removedPaths` are tombstones: paths of ever-live DB pages that have
 * since been unpublished or archived. Static pages at those paths are
 * dropped instead of resurrecting - an urgent takedown must stick even
 * where a bundled MDX twin exists. Tombstones with no static twin are
 * simply no-ops, and an API item at a tombstoned path still wins (the
 * API only tombstones paths it is not serving).
 */
export function mergeNavPages(
  apiPages: NavPage[],
  staticPages: NavPage[],
  removedPaths: readonly string[] = [],
): NavPage[] {
  const removed = new Set(removedPaths);
  const byPath = new Map<string, NavPage>();
  for (const page of staticPages) {
    if (!removed.has(page.path)) byPath.set(page.path, page);
  }
  for (const page of apiPages) byPath.set(page.path, page);
  return Array.from(byPath.values()).toSorted((a, b) =>
    a.path.localeCompare(b.path),
  );
}

/**
 * Get the parent path of a given path.
 * "/club/history/honours" → "/club/history"
 * "/club" → null (top-level)
 */
function parentPath(path: string): string | null {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return path.substring(0, lastSlash);
}

/**
 * Build a tree of NavNodes for sidebar navigation.
 * Given a page path, finds the top-level ancestor and returns
 * the full subtree under that ancestor.
 *
 * Children sort by menuOrder; the sort is stable, so equal menuOrders
 * keep the input (path) order - same tie-break as the old static-only
 * implementation.
 */
export function getNavigationTree(
  pages: NavPage[],
  currentPath: string,
): NavNode | null {
  // Find the top-level section (e.g. "/club" from "/club/history/honours")
  const segments = currentPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const sectionPath = "/" + segments[0];
  const sectionPage = pages.find((p) => p.path === sectionPath);
  if (!sectionPage) return null;

  // Build the subtree
  function buildNode(page: NavPage): NavNode {
    const children = pages
      .filter((p) => parentPath(p.path) === page.path)
      .sort((a, b) => a.menuOrder - b.menuOrder);

    return {
      page,
      children: children.map(buildNode),
    };
  }

  return buildNode(sectionPage);
}

/**
 * Build breadcrumb trail from root to current page.
 * Returns array of { title, path } from ancestor to current.
 * Ancestors missing from the page list are skipped.
 */
export function getBreadcrumbs(
  pages: NavPage[],
  currentPath: string,
): Array<{ title: string; path: string }> {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const crumbs: Array<{ title: string; path: string }> = [];
  let path: string | null = currentPath;

  while (path) {
    const page = byPath.get(path);
    if (page) {
      crumbs.unshift({ title: page.title, path: page.path });
    }
    path = parentPath(path);
  }

  return crumbs;
}

/**
 * Get the top-level content sections that should appear in the main menu.
 */
export function getMainMenuItems(pages: NavPage[]): NavPage[] {
  return pages
    .filter((p) => p.isMainMenu)
    .sort((a, b) => a.menuOrder - b.menuOrder);
}
