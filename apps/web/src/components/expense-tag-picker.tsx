import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

/**
 * Tag multi-select for expense claims. Works in tag NAMES (the API resolves
 * names to the shared vocabulary, creating new ones), so both the claimant's
 * proposal and the approver's edit use the same control. Existing tags toggle
 * on/off; a free-text box adds a brand new tag.
 */
export function ExpenseTagPicker({
  available,
  selected,
  onChange,
}: {
  available: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const selectedSet = new Set(selected.map((s) => s.toLowerCase()));
  const toggle = (name: string) => {
    if (selectedSet.has(name.toLowerCase())) {
      onChange(selected.filter((s) => s.toLowerCase() !== name.toLowerCase()));
    } else {
      onChange([...selected, name]);
    }
  };

  const addDraft = () => {
    const name = draft.trim();
    if (!name) return;
    if (!selectedSet.has(name.toLowerCase())) onChange([...selected, name]);
    setDraft("");
  };

  // Tags chosen that aren't part of the known vocabulary yet (newly typed).
  const extras = selected.filter(
    (s) => !available.some((a) => a.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {available.map((name) => (
          <button key={name} type="button" onClick={() => toggle(name)}>
            <Badge
              variant={
                selectedSet.has(name.toLowerCase()) ? "default" : "secondary"
              }
              className="cursor-pointer"
            >
              {name}
            </Badge>
          </button>
        ))}
        {extras.map((name) => (
          <button key={name} type="button" onClick={() => toggle(name)}>
            <Badge variant="default" className="cursor-pointer">
              {name} (new)
            </Badge>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder="Add a tag…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          className="w-48"
        />
        <Button type="button" variant="outline" size="sm" onClick={addDraft}>
          Add
        </Button>
      </div>
    </div>
  );
}
