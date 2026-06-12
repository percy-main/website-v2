import {
  PERSON_GRID_CLASSES,
  PersonCardShell,
} from "@/components/mdx-components.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select.js";
import type { PersonGridEntry } from "@/lib/person-grid.js";
import {
  usePeople,
  usePeopleList,
  type PersonSummary,
} from "@/lib/use-people.js";

/**
 * WYSIWYG controls for the personGrid block (#527): the grid itself is
 * the editor. Each card renders the shared public card shell with an
 * inline role input and a top-right remove button, and the trailing
 * dashed "+" card appends a person - so what authors see is what the
 * published page shows.
 */
export function PersonGridEditor({
  entries,
  onWrite,
}: {
  entries: PersonGridEntry[];
  onWrite: (next: PersonGridEntry[]) => void;
}) {
  const people = usePeople();
  const allPeople = usePeopleList();
  const inGrid = new Set(entries.map((entry) => entry.slug));

  const setRole = (index: number, role: string) => {
    onWrite(
      entries.map((entry, i) =>
        i === index
          ? // Empty role is omitted, never stored as "" (NULL-for-unset).
            { slug: entry.slug, ...(role !== "" && { role }) }
          : entry,
      ),
    );
  };

  return (
    <div className={PERSON_GRID_CLASSES}>
      {entries.map((entry, i) => {
        const person = people.get(entry.slug);
        const name = person?.name ?? entry.slug;
        return (
          <div key={`${entry.slug}-${String(i)}`} className="relative">
            <PersonCardShell
              name={name}
              picture={person?.picture}
              photoUrl={person?.photoUrl}
            >
              <input
                aria-label={`Role shown for ${name}`}
                placeholder="Role (optional)"
                value={entry.role ?? ""}
                onChange={(e) => {
                  setRole(i, e.target.value);
                }}
                className="mx-auto block w-5/6 rounded border border-stone-200 bg-white px-1 py-0.5 text-center text-sm text-stone-600 placeholder:text-stone-400"
              />
            </PersonCardShell>
            <button
              type="button"
              aria-label={`Remove ${name} from the grid`}
              onClick={() => {
                onWrite(entries.filter((_, j) => j !== i));
              }}
              className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-white text-stone-500 shadow hover:bg-stone-100 hover:text-stone-900"
            >
              ×
            </button>
          </div>
        );
      })}
      <AddPersonCard
        people={allPeople.filter((p) => !inGrid.has(p.slug))}
        onAdd={(slug) => {
          onWrite([...entries, { slug }]);
        }}
      />
    </div>
  );
}

/**
 * The empty "+" card: the whole card is a Select trigger, so one click
 * opens the person picker. Kept always-empty (value="") so each pick
 * appends and the card resets. Hidden once everyone is already in the
 * grid - there is nobody left to add.
 */
function AddPersonCard({
  people,
  onAdd,
}: {
  people: PersonSummary[];
  onAdd: (slug: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <Select value="" onValueChange={onAdd}>
      <SelectTrigger
        aria-label="Add a person to the grid"
        className="h-full min-h-48 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 bg-transparent whitespace-normal shadow-none hover:border-stone-400 hover:bg-stone-50"
      >
        <span aria-hidden className="text-4xl leading-none text-stone-400">
          +
        </span>
        <span className="text-sm text-stone-500">Add person</span>
      </SelectTrigger>
      <SelectContent>
        {people.map((p) => (
          <SelectItem key={p.slug} value={p.slug}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
