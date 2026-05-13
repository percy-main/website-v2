import { format, isValid, parseISO } from "date-fns";

/**
 * Coerce a date string from Play-Cricket / our API to a YYYY-MM-DD ISO
 * date (no time). Some upstream endpoints (e.g. /api/matchday/teams/:id/
 * upcoming, /api/games) pass through Play-Cricket's DD/MM/YYYY format
 * verbatim; consumers that want to compare / sort / new Date() need a
 * normalised form. Returns null on unparseable / empty input.
 */
export function toIsoDate(input: string | null | undefined): string | null {
  if (!input) return null;
  // Already ISO (YYYY-MM-DD or YYYY-MM-DDT…) — take the date part.
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(input);
  if (isoMatch) return isoMatch[1] ?? null;
  // DD/MM/YYYY → YYYY-MM-DD.
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

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
  input: string | Date | null | undefined,
  pattern = "EEE d MMM",
): string {
  if (input === null || input === undefined || input === "") return "";
  if (input instanceof Date) {
    return isValid(input) ? format(input, pattern) : "";
  }
  // Try ISO first, then the DD/MM/YYYY fallback via toIsoDate.
  const isoCandidate = toIsoDate(input) ?? input;
  const d = parseISO(isoCandidate);
  if (!isValid(d)) return input;
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
