import { navQueryOptions } from "@/lib/content-queries.js";
import { staticNavPages } from "@/lib/content.js";
import { mergeNavPages, type NavPage } from "@/lib/nav.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

// While the nav query is in flight the placeholder stands in: an empty
// API list merges to the static-only nav, so headers and sidebars render
// immediately with no flash - pre-migration (DB holds no published
// pages) the settled output is byte-identical to the placeholder, so
// nothing ever jumps. Module-level constant for referential stability.
const EMPTY_NAV: { items: NavPage[] } = { items: [] };

/**
 * The merged site nav (#493): published DB pages from the API plus
 * static MDX pages not shadowed by a DB page at the same path. On API
 * error the query data stays unset and this degrades to the static-only
 * list - nav never breaks.
 */
export function useSiteNav(): NavPage[] {
  const { data } = useQuery({
    ...navQueryOptions(),
    placeholderData: EMPTY_NAV,
  });

  const items = data?.items;
  return useMemo(() => mergeNavPages(items ?? [], staticNavPages), [items]);
}
