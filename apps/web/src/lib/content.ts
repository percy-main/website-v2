import type { FC } from "react";
import type { NavPage } from "./nav.js";

interface MdxModule {
  default: FC;
  frontmatter: Record<string, unknown>;
}

export interface ContentPage {
  /** URL path, e.g. "/club/history/honours" */
  path: string;
  /** MDX frontmatter */
  title: string;
  description?: string;
  menuOrder: number;
  isMainMenu: boolean;
  hideTitle: boolean;
  ldjson?: unknown;
  /** The React component that renders the MDX content */
  Component: FC;
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
      description: fm.description as string | undefined,
      menuOrder: (fm.menuOrder as number) ?? 99,
      isMainMenu: (fm.isMainMenu as boolean) ?? false,
      hideTitle: (fm.hideTitle as boolean) ?? false,
      ldjson: fm.ldjson,
      Component: mod.default,
    };
  });
}

/** All content pages, sorted by path for predictable ordering */
const contentPages: ContentPage[] = loadPages().sort((a, b) =>
  a.path.localeCompare(b.path),
);

/** Map from URL path to ContentPage for fast lookups */
export const contentPageMap = new Map(contentPages.map((p) => [p.path, p]));

/**
 * Static pages projected to the lightweight NavPage shape, ready to merge
 * with the API nav list (lib/nav.ts, #493). Path-sorted because
 * contentPages is - mergeNavPages relies on that ordering for the
 * static-only case to match the old behaviour exactly.
 */
export const staticNavPages: NavPage[] = contentPages.map((p) => ({
  path: p.path,
  title: p.title,
  menuOrder: p.menuOrder,
  isMainMenu: p.isMainMenu,
}));
