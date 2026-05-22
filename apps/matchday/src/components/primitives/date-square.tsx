import { fmtDate } from "@/features/format.js";
import { cn } from "@/lib/utils";

/**
 * 44pt date square used across home/fixtures/donations rows.
 *
 * `tone` is computed from how close the match is:
 *   - "today"  → strong navy bg, white text. Match day energy.
 *   - "soon"   → tinted navy bg, navy text. Tomorrow → "this match"
 *                signal so the next game stands out from the rest of
 *                the fixture list.
 *   - default  → stone bg, navy number. Standard treatment.
 *
 * Pass an ISO `YYYY-MM-DD` (or null) — `compareIso` does the comparison
 * against today's local-time ISO date, no timezone shenanigans.
 *
 * `dayLabel` defaults to the abbreviated weekday ("SAT") but can be
 * overridden to show month ("MAY") on the fixtures list where multiple
 * weeks are visible.
 */
export type DateSquareTone = "today" | "soon" | "default";

export function dateSquareTone(iso: string | null | undefined): DateSquareTone {
  if (!iso) return "default";
  const today = todayIso();
  if (iso === today) return "today";
  if (iso === addDaysIso(today, 1)) return "soon";
  return "default";
}

export function DateSquare({
  iso,
  dayLabel = "weekday",
  className,
}: {
  iso: string | null | undefined;
  /** "weekday" → SAT, "month" → MAY. Defaults to weekday. */
  dayLabel?: "weekday" | "month";
  className?: string;
}) {
  const tone = dateSquareTone(iso);
  const d = iso ? new Date(iso) : null;
  const day = d && !isNaN(d.getTime()) ? d.getDate() : "";
  const sub =
    d && !isNaN(d.getTime())
      ? dayLabel === "month"
        ? fmtDate(iso, "MMM")
        : fmtDate(iso, "EEE")
      : "";
  return (
    <div
      className={cn(
        "flex size-11 flex-col items-center justify-center rounded-md py-1 transition-colors",
        tone === "today"
          ? "bg-navy dark:text-navy text-white dark:bg-white"
          : tone === "soon"
            ? "bg-info-bg text-navy dark:bg-white/10 dark:text-white"
            : "bg-surface-raised text-navy dark:text-white",
        className,
      )}
    >
      <div className="text-base leading-none font-bold">{day}</div>
      <div
        className={cn(
          "text-[10px] tracking-wide uppercase",
          tone === "today"
            ? "dark:text-navy/70 text-white/75"
            : tone === "soon"
              ? "text-navy/70 dark:text-white/70"
              : "text-text-secondary",
        )}
      >
        {sub}
      </div>
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
