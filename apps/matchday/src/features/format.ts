import { format, parseISO } from "date-fns";

/**
 * Format a YYYY-MM-DD string from the API without timezone shenanigans.
 *
 * Background: `GET /availability/active` and friends return `match_date` as
 * a plain date string (no time, no zone). Passing `new Date("2026-05-18")`
 * parses as UTC midnight, which in BST flips back to 2026-05-17. Always
 * parse via `parseISO` and treat as local.
 */
export function fmtDate(
  isoYmd: string | Date,
  pattern = "EEE d MMM",
): string {
  const d = typeof isoYmd === "string" ? parseISO(isoYmd) : isoYmd;
  return format(d, pattern);
}

export function fmtMoneyPence(pence: number | string | null | undefined): string {
  if (pence === null || pence === undefined) return "£0";
  const n = typeof pence === "string" ? Number(pence) : pence;
  if (!Number.isFinite(n)) return "£0";
  return `£${(n / 100).toFixed(2).replace(/\.00$/, "")}`;
}
