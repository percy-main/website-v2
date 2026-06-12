import { navQueryOptions } from "@/lib/content-queries.js";
import { sortNavPages, type NavPage } from "@/lib/nav.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * The site nav (#493): published DB pages from the API, path-sorted. On
 * API error (or while the first request is in flight) this degrades to
 * an empty list - headers and sidebars render without section links
 * rather than breaking.
 */
export function useSiteNav(): NavPage[] {
  const { data } = useQuery(navQueryOptions());
  const items = data?.items;
  return useMemo(() => sortNavPages(items ?? []), [items]);
}
