import { format, isValid, parseISO } from "date-fns";

/**
 * Format a YYYY-MM-DD string from the API without timezone shenanigans.
 *
 * Background: `GET /availability/active` and friends return `match_date` as
 * a plain date string (no time, no zone). Passing `new Date("2026-05-18")`
 * parses as UTC midnight, which in BST flips back to 2026-05-17. Always
 * parse via `parseISO` and treat as local.
 *
 * Defensive — date-fns' `format` throws "Invalid time value" on a bad
 * Date, which crashes the entire React tree because the call sites
 * (squad TeamCard, fixtures list) inline it inside JSX. If the input is
 * empty / null / unparseable, return the raw string so the UI degrades
 * gracefully and a server-side data hiccup doesn't take down the page.
 *
 * Accepts the column straight from Play-Cricket which may be a full
 * datetime ("2026-05-11T13:00:00.000Z") rather than a YYYY-MM-DD plain
 * date — both shapes pass through cleanly.
 */
export function fmtDate(
  isoYmd: string | Date | null | undefined,
  pattern = "EEE d MMM",
): string {
  if (isoYmd === null || isoYmd === undefined || isoYmd === "") return "";
  const d = typeof isoYmd === "string" ? parseISO(isoYmd) : isoYmd;
  if (!isValid(d)) return typeof isoYmd === "string" ? isoYmd : "";
  return format(d, pattern);
}

export function fmtMoneyPence(
  pence: number | string | null | undefined,
): string {
  if (pence === null || pence === undefined) return "£0";
  const n = typeof pence === "string" ? Number(pence) : pence;
  if (!Number.isFinite(n)) return "£0";
  return `£${(n / 100).toFixed(2).replace(/\.00$/, "")}`;
}
