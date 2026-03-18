interface PeopleMdxModule {
  frontmatter: Record<string, unknown>;
}

export interface PersonData {
  name: string;
  slug: string;
  photo?: string;
  isDBSChecked: boolean;
  hasLeftClub: boolean;
}

const modules = import.meta.glob<PeopleMdxModule>(
  "../../content/people/*.mdx",
  { eager: true },
);

const people = new Map<string, PersonData>();

for (const mod of Object.values(modules)) {
  const fm = mod.frontmatter;
  const slug = fm.slug as string;
  people.set(slug, {
    name: (fm.name as string) ?? slug,
    slug,
    photo: fm.photo as string | undefined,
    isDBSChecked: (fm.isDBSChecked as boolean) ?? false,
    hasLeftClub: (fm.hasLeftClub as boolean) ?? false,
  });
}

export function getPersonBySlug(slug: string): PersonData | undefined {
  return people.get(slug);
}
