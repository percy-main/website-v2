import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select.js";
import { cn } from "@/lib/utils.js";
import { useState, type ReactNode } from "react";
import { IoSettingsOutline } from "react-icons/io5";

// Shared furniture for WYSIWYG editor blocks (#527 follow-up): blocks
// render their published appearance directly; config props with no
// visual form on the page (ids, alt text) live behind a settings gear,
// and empty blocks present a dashed placeholder card.

/** Dashed placeholder-card styling shared by PickerCard and custom
 * empty-state triggers, so every "set this block up" card looks alike. */
export const EMPTY_CARD_CLASSES =
  "flex min-h-48 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 bg-transparent hover:border-stone-400 hover:bg-stone-50";

/**
 * Classes for text edited in place on a block: pass the public
 * element's text classes so the input reads exactly like the published
 * output, with a border that only appears on hover/focus as the
 * editability affordance.
 */
export const INLINE_TEXT_INPUT_CLASSES = (textClasses: string) =>
  cn(
    "w-full rounded border border-transparent bg-transparent placeholder:text-stone-400 hover:border-stone-200 focus:border-stone-300 focus:outline-none",
    textClasses,
  );

/** The "+" and prompt rendered inside every empty placeholder card. */
export function EmptyCardPrompt({ prompt }: { prompt: string }) {
  return (
    <>
      <span aria-hidden className="text-4xl leading-none text-stone-400">
        +
      </span>
      <span className="text-sm text-stone-500">{prompt}</span>
    </>
  );
}

/**
 * Settings affordance for an editor block: a small gear at the block's
 * top right (the host wraps the block in `relative`) opening a modal
 * with the config fields. Pass `trigger` to replace the gear - e.g. an
 * empty block renders a dashed placeholder card that opens the same
 * modal.
 */
export function BlockSettings({
  label,
  title,
  children,
  trigger,
}: {
  /** Accessible name for the default gear trigger. */
  label: string;
  /** Modal heading. */
  title: string;
  /** The config fields shown inside the modal. */
  children: ReactNode;
  trigger?: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger ? (
        trigger(() => {
          setOpen(true);
        })
      ) : (
        <button
          type="button"
          aria-label={label}
          onClick={() => {
            setOpen(true);
          }}
          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-white text-stone-500 shadow hover:bg-stone-100 hover:text-stone-900"
        >
          <IoSettingsOutline aria-hidden />
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-3">{children}</div>
          <DialogFooter>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A dashed placeholder card that is itself a Select trigger, so one
 * click opens the picker (the person grid's "+" card pattern). Kept
 * always-empty (value="") so each pick fires onPick and the card
 * resets. Renders nothing when there is nothing left to pick.
 */
export function PickerCard({
  label,
  prompt,
  options,
  onPick,
}: {
  /** Accessible name for the card trigger. */
  label: string;
  /** Text shown under the "+". */
  prompt: string;
  options: Array<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <Select value="" onValueChange={onPick}>
      <SelectTrigger
        aria-label={label}
        className={`h-full whitespace-normal shadow-none ${EMPTY_CARD_CLASSES}`}
      >
        <EmptyCardPrompt prompt={prompt} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
