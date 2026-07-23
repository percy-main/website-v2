import {
  PERSON_GRID_CLASSES,
  PersonCardShell,
} from "@/components/mdx-components.js";
import type { PictureSource } from "@/components/optimised-image.js";
import type { PersonGridEntry } from "@/lib/person-grid.js";
import {
  usePeople,
  usePeopleList,
  type PersonSummary,
} from "@/lib/use-people.js";
import { PickerCard } from "./block-controls.js";

// WYSIWYG editors for the person and personGrid blocks (#527): the
// rendered card is the editor. Each card carries an inline role input
// and a top-right remove button; empty slots are dashed picker cards.

/** A person card with its role editable in place and an "x" to remove. */
function EditablePersonCard({
  name,
  picture,
  role,
  removeLabel,
  onRoleChange,
  onRemove,
}: {
  name: string;
  picture?: PictureSource;
  role: string;
  removeLabel: string;
  onRoleChange: (role: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative">
      <PersonCardShell name={name} picture={picture}>
        <input
          aria-label={`Role shown for ${name}`}
          placeholder="Role (optional)"
          value={role}
          onChange={(e) => {
            onRoleChange(e.target.value);
          }}
          className="mx-auto block w-5/6 rounded border border-stone-200 bg-white px-1 py-0.5 text-center text-sm text-stone-600 placeholder:text-stone-400"
        />
      </PersonCardShell>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-white text-stone-500 shadow hover:bg-stone-100 hover:text-stone-900"
      >
        ×
      </button>
    </div>
  );
}

const personOptions = (people: PersonSummary[]) =>
  people.map((p) => ({ value: p.slug, label: p.name }));

/**
 * WYSIWYG controls for the personGrid block: the grid itself is the
 * editor, rendered with the same card shell and layout as the public
 * page. The trailing dashed "+" card appends a person and hides once
 * everyone is already in the grid.
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
          <EditablePersonCard
            key={entry.slug}
            name={name}
            picture={person?.picture}
            role={entry.role ?? ""}
            removeLabel={`Remove ${name} from the grid`}
            onRoleChange={(role) => {
              setRole(i, role);
            }}
            onRemove={() => {
              onWrite(entries.filter((_, j) => j !== i));
            }}
          />
        );
      })}
      <PickerCard
        label="Add a person to the grid"
        prompt="Add person"
        options={personOptions(allPeople.filter((p) => !inGrid.has(p.slug)))}
        onPick={(slug) => {
          onWrite([...entries, { slug }]);
        }}
      />
    </div>
  );
}

/**
 * WYSIWYG controls for the single person block: an empty slot is a
 * dashed picker card; a filled one is the card with its role editable
 * in place. The "x" empties the slot back to the picker (deleting the
 * whole block is BlockNote's own affordance).
 */
export function PersonEditor({
  slug,
  role,
  onChange,
}: {
  slug: string;
  role: string;
  onChange: (next: { slug: string; role: string }) => void;
}) {
  const people = usePeople();
  const allPeople = usePeopleList();

  if (!slug) {
    return (
      <PickerCard
        label="Choose a person to display"
        prompt="Choose person"
        options={personOptions(allPeople)}
        onPick={(picked) => {
          onChange({ slug: picked, role });
        }}
      />
    );
  }

  const person = people.get(slug);
  const name = person?.name ?? slug;
  return (
    <EditablePersonCard
      name={name}
      picture={person?.picture}
      role={role}
      removeLabel={`Remove ${name}`}
      onRoleChange={(next) => {
        onChange({ slug, role: next });
      }}
      onRemove={() => {
        onChange({ slug: "", role: "" });
      }}
    />
  );
}
