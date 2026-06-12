import type { PictureSource } from "@/components/optimised-image.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  parsePersonMetadata,
  peopleListQueryOptions,
} from "./content-queries.js";
import { getAllPeople } from "./people.js";

// DB-backed people resolution (#499) with the bundled MDX corpus as a
// per-slug fallback until the migration is verified in prod (TRANSITION
// FALLBACK #489 - the cleanup PR removes people.ts and the fallback
// together). The whole roster rides one cached list query, so a page
// full of person cards costs one request, not one per card.

/** Person fields shared by API-backed and static-bundled profiles. */
export interface PersonSummary {
  slug: string;
  name: string;
  /** Responsive picture (API photo descriptor or static optimised import). */
  picture?: PictureSource;
  /** Static corpus only: plain <img> URL when no picture exists. */
  photoUrl?: string;
  isDBSChecked: boolean;
  hasLeftClub: boolean;
}

/** The static loader's fields the merge reads (people.ts PersonData). */
interface StaticPerson {
  slug: string;
  name: string;
  photo?: string;
  photoPicture?: PictureSource;
  isDBSChecked: boolean;
  hasLeftClub: boolean;
}

interface PeopleListData {
  items: Array<{ slug: string; title: string; metadata: unknown }>;
  removed: string[];
}

/**
 * Merge the API roster over the static corpus, by slug. Pure and
 * exported for tests; usePeople feeds it the live query data.
 *
 * The API wins per slug; static people missing from it (not migrated
 * yet, or the query has no data) fill the gaps, so cards render
 * instantly from the bundle and never break on API trouble. Tombstoned
 * slugs (data.removed) are dropped AND guarded against in the items
 * pass, so a taken-down profile cannot resurrect from the static bundle
 * even if the server's items/removed partition were ever violated.
 *
 * Known fail-open window, accepted deliberately: while the query is
 * pending or has never succeeded, the static corpus renders unfiltered,
 * so a tombstoned person's CARD (name + photo only - cards carry no DBS
 * badge or flags) can appear until the roster lands; a background
 * refetch failure keeps the last successful response, tombstones
 * included. The full profile page fails CLOSED on API errors instead
 * (person-profile.tsx) - that is the page with the safeguarding
 * surface. The window disappears with the static corpus in the cleanup
 * PR.
 */
export function mergePeople(
  staticPeople: readonly StaticPerson[],
  data: PeopleListData | undefined,
): Map<string, PersonSummary> {
  const removed = new Set(data?.removed ?? []);
  const map = new Map<string, PersonSummary>();
  for (const person of staticPeople) {
    if (removed.has(person.slug)) continue;
    map.set(person.slug, {
      slug: person.slug,
      name: person.name,
      ...(person.photoPicture !== undefined && {
        picture: person.photoPicture,
      }),
      ...(person.photo !== undefined && { photoUrl: person.photo }),
      isDBSChecked: person.isDBSChecked,
      hasLeftClub: person.hasLeftClub,
    });
  }
  for (const item of data?.items ?? []) {
    // Never resurrect a tombstone, whatever the server sent.
    if (removed.has(item.slug)) continue;
    const meta = parsePersonMetadata(item.metadata);
    // A roster row whose metadata fails its schema is unrenderable -
    // keep the static entry (if any) rather than a half-built one.
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

/** Every known person, keyed by slug - see mergePeople for semantics. */
export function usePeople(): Map<string, PersonSummary> {
  const { data } = useQuery(peopleListQueryOptions());
  return useMemo(() => mergePeople(getAllPeople(), data), [data]);
}

/** The merged roster as a name-sorted list (pickers, grids). */
export function usePeopleList(): PersonSummary[] {
  const people = usePeople();
  return useMemo(
    () =>
      Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );
}
