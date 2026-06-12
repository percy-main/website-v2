import type { PictureSource } from "@/components/optimised-image.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  parsePersonMetadata,
  peopleListQueryOptions,
} from "./content-queries.js";

// DB-backed people resolution (#499). The whole roster rides one cached
// list query, so a page full of person cards costs one request, not one
// per card.

/** Person fields the roster exposes to cards, pickers and grids. */
export interface PersonSummary {
  slug: string;
  name: string;
  /** Responsive picture from the API photo descriptor. */
  picture?: PictureSource;
  isDBSChecked: boolean;
  hasLeftClub: boolean;
}

interface PeopleListData {
  items: Array<{ slug: string; title: string; metadata: unknown }>;
  removed: string[];
}

/**
 * Project the API roster into renderable summaries, keyed by slug. Pure
 * and exported for tests; usePeople feeds it the live query data.
 *
 * Tombstoned slugs (data.removed) are guarded against in the items pass,
 * so a taken-down profile cannot render even if the server's
 * items/removed partition were ever violated. A roster row whose
 * metadata fails its schema is unrenderable and dropped.
 */
export function buildPeople(
  data: PeopleListData | undefined,
): Map<string, PersonSummary> {
  const removed = new Set(data?.removed ?? []);
  const map = new Map<string, PersonSummary>();
  for (const item of data?.items ?? []) {
    if (removed.has(item.slug)) continue;
    const meta = parsePersonMetadata(item.metadata);
    if (!meta) continue;
    map.set(item.slug, {
      slug: item.slug,
      name: item.title,
      ...(meta.photo !== undefined && { picture: meta.photo }),
      isDBSChecked: meta.isDBSChecked,
      hasLeftClub: meta.hasLeftClub,
    });
  }
  return map;
}

/** Every known person, keyed by slug - see buildPeople for semantics. */
export function usePeople(): Map<string, PersonSummary> {
  const { data } = useQuery(peopleListQueryOptions());
  return useMemo(() => buildPeople(data), [data]);
}

/** The roster as a name-sorted list (pickers, grids). */
export function usePeopleList(): PersonSummary[] {
  const people = usePeople();
  return useMemo(
    () =>
      Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );
}
