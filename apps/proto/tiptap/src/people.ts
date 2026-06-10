// Stand-in for apps/web's people data. The real editor will resolve
// ::person{slug="..."} against the people content type.
export type Person = { slug: string; name: string; role?: string };

export const PEOPLE: Person[] = [
  { slug: "alex-slaven", name: "Alex Slaven", role: "1st XI Captain" },
  { slug: "jane-robson", name: "Jane Robson", role: "Club Secretary" },
  { slug: "sam-ahmed", name: "Sam Ahmed", role: "Junior Coach" },
];

export function getPersonBySlug(slug: string): Person | undefined {
  return PEOPLE.find((p) => p.slug === slug);
}
