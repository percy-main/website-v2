import { getPersonBySlug } from "./people";

// Visual stand-in for apps/web/src/components/mdx-components.tsx Person.
// Initials avatar instead of the photo pipeline; otherwise the same card.
export function PersonCard({ slug }: { slug: string }) {
  const person = getPersonBySlug(slug);
  const name = person?.name ?? slug;
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="w-48 rounded-lg bg-white pb-4 text-stone-900 shadow-md">
      <div className="h-2 rounded-t-lg bg-gradient-to-r from-red-700 to-orange-400" />
      <div className="mx-auto mt-4 flex size-24 items-center justify-center rounded-full border-4 border-stone-100 bg-stone-200 text-2xl font-bold text-stone-500">
        {initials}
      </div>
      <div className="mt-3 text-center">
        <h5 className="pb-1 font-semibold">{name}</h5>
        {person?.role && (
          <p className="text-sm text-stone-600">{person.role}</p>
        )}
        <span className="mt-2 inline-block px-2 text-sm font-medium text-red-700 underline">
          Profile
        </span>
      </div>
    </div>
  );
}
