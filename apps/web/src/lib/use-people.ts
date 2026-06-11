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

/**
 * Every known person, keyed by slug. The API roster wins per slug; static
 * people missing from it (not migrated yet, or the query is still
 * pending/failed) fill the gaps, so cards render instantly from the
 * bundle and never break on API trouble.
 */
export function usePeople(): Map<string, PersonSummary> {
  const { data } = useQuery(peopleListQueryOptions());

  return useMemo(() => {
    const map = new Map<string, PersonSummary>();
    for (const person of getAllPeople()) {
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
  }, [data]);
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
