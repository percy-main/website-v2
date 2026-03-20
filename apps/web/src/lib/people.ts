import type { PictureSource } from "@/components/optimised-image.js";
import { getImageUrl, getPicture } from "@/lib/image-map.js";
import type { FC } from "react";

interface PeopleMdxModule {
  default: FC;
  frontmatter: Record<string, unknown>;
}

export interface PersonData {
  name: string;
  slug: string;
  /** Resolved image URL (for <img> fallback / canvas usage) */
  photo?: string;
  /** Optimised picture source (for <picture> rendering) */
  photoPicture?: PictureSource;
  isDBSChecked: boolean;
  hasLeftClub: boolean;
  Component: FC;
}

const modules = import.meta.glob<PeopleMdxModule>(
  "../../content/people/*.mdx",
  { eager: true },
);

const people = new Map<string, PersonData>();

for (const mod of Object.values(modules)) {
  const fm = mod.frontmatter;
  const slug = fm.slug as string;
  const rawPhoto = fm.photo as string | undefined;
  people.set(slug, {
    name: (fm.name as string) ?? slug,
    slug,
    photo: rawPhoto ? getImageUrl(rawPhoto) : undefined,
    photoPicture: rawPhoto ? getPicture(rawPhoto) : undefined,
    isDBSChecked: (fm.isDBSChecked as boolean) ?? false,
    hasLeftClub: (fm.hasLeftClub as boolean) ?? false,
    Component: mod.default,
  });
}

export function getPersonBySlug(slug: string): PersonData | undefined {
  return people.get(slug);
}
