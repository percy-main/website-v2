import type { FC } from "react";

interface MdxModule {
  default: FC;
  frontmatter: Record<string, unknown>;
}

export interface ContentPage {
  /** URL path, e.g. "/club/history/honours" */
  path: string;
  /** MDX frontmatter */
  title: string;
  menuOrder: number;
  isMainMenu: boolean;
  ldjson?: unknown;
  /** The React component that renders the MDX content */
  Component: FC;
}

export interface ContentNode {
  page: ContentPage;
  children: ContentNode[];
}

/**
 * Discover all MDX content pages from the filesystem.
 * Uses Vite's import.meta.glob to eagerly load all .mdx files under content/pages/.
 * File path structure maps directly to URL paths:
 *   content/pages/club/_index.mdx  → /club
 *   content/pages/club/history/_index.mdx → /club/history
 *   content/pages/club/committee.mdx → /club/committee
 */
const modules = import.meta.glob<MdxModule>("../../content/pages/**/*.mdx", {
  eager: true,
});

function filePathToUrlPath(filePath: string): string {
  // filePath looks like "../../content/pages/club/history/_index.mdx"
  // Strip the prefix and extension
  let path = filePath.replace("../../content/pages/", "").replace(/\.mdx$/, "");

  // _index files represent the directory itself
  path = path.replace(/\/_index$/, "").replace(/^_index$/, "");

  return "/" + path;
}

function loadPages(): ContentPage[] {
  return Object.entries(modules).map(([filePath, mod]) => {
    const fm = mod.frontmatter ?? {};
    return {
      path: filePathToUrlPath(filePath),
      title: (fm.title as string) ?? "Untitled",
      menuOrder: (fm.menuOrder as number) ?? 99,
      isMainMenu: (fm.isMainMenu as boolean) ?? false,
      ldjson: fm.ldjson,
      Component: mod.default,
    };
  });
}

/** All content pages, sorted by path for predictable ordering */
export const contentPages: ContentPage[] = loadPages().sort((a, b) =>
  a.path.localeCompare(b.path),
);

/** Map from URL path to ContentPage for fast lookups */
export const contentPageMap = new Map(contentPages.map((p) => [p.path, p]));

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
 * Build a tree of ContentNodes for sidebar navigation.
 * Given a page path, finds the top-level ancestor and returns
 * the full subtree under that ancestor.
 */
export function getNavigationTree(currentPath: string): ContentNode | null {
  // Find the top-level section (e.g. "/club" from "/club/history/honours")
  const segments = currentPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const sectionPath = "/" + segments[0];
  const sectionPage = contentPageMap.get(sectionPath);
  if (!sectionPage) return null;

  // Build the subtree
  function buildNode(page: ContentPage): ContentNode {
    const children = contentPages
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
 */
export function getBreadcrumbs(
  currentPath: string,
): Array<{ title: string; path: string }> {
  const crumbs: Array<{ title: string; path: string }> = [];
  let path: string | null = currentPath;

  while (path) {
    const page = contentPageMap.get(path);
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
export function getMainMenuItems(): ContentPage[] {
  return contentPages
    .filter((p) => p.isMainMenu)
    .sort((a, b) => a.menuOrder - b.menuOrder);
}
