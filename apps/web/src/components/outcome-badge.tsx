import { cn } from "@/lib/utils.js";

type Outcome = "W" | "L" | "D" | "T" | "A" | "C" | "N";

const config: Record<
  Outcome,
  { label: string; bg: string; text: string; icon: "check" | "x" | null }
> = {
  W: {
    label: "WON",
    bg: "bg-green-100",
    text: "text-green-700",
    icon: "check",
  },
  L: { label: "LOST", bg: "bg-red-100", text: "text-red-700", icon: "x" },
  D: { label: "DRAW", bg: "bg-amber-100", text: "text-amber-700", icon: null },
  T: { label: "TIED", bg: "bg-amber-100", text: "text-amber-700", icon: null },
  A: { label: "ABAN", bg: "bg-stone-100", text: "text-stone-500", icon: null },
  C: { label: "CANC", bg: "bg-stone-100", text: "text-stone-500", icon: null },
  N: { label: "N/R", bg: "bg-stone-100", text: "text-stone-500", icon: null },
};

export function OutcomeBadge({
  outcome,
  scoreDescription,
}: {
  outcome: Outcome;
  scoreDescription?: string;
}) {
  const c = config[outcome];

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
          c.bg,
          c.text,
        )}
      >
        {c.icon === "check" && (
          <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {c.icon === "x" && (
          <svg className="size-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {c.label}
      </span>
      {scoreDescription && (
        <span className="text-[11px] font-semibold text-stone-400">
          {scoreDescription}
        </span>
      )}
    </div>
  );
}
