/**
 * Pure helpers for the calendar-month page.
 *
 * Extracted so they can be unit-tested without React/DOM. The page
 * component still owns react-query, navigation, and rendering.
 */

import { isBefore } from "date-fns";

export type TeamCategory = "1xi" | "2xi" | "mid" | "jun";
export type Filter = "all" | TeamCategory | "event";

export const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/**
 * Coerces a play-cricket team name into a calendar category. Falls back
 * to "1xi" for anything unrecognised — most often a touring/friendly
 * fixture that should sit alongside the senior teams.
 */
export function categoriseTeam(teamName: string): TeamCategory {
  if (/1st/i.test(teamName)) return "1xi";
  if (/2nd/i.test(teamName)) return "2xi";
  if (/midweek/i.test(teamName)) return "mid";
  if (/under|junior|colts|\bU\d{2}\b/i.test(teamName)) return "jun";
  return "1xi";
}

/**
 * Parses the year + month route params into a numeric year and 0-indexed
 * month, or null when either is malformed. Month is matched
 * case-insensitively against the English month-name list.
 */
export function parseMonthYear(
  yearParam: string,
  monthParam: string,
): { year: number; monthIndex: number } | null {
  const year = parseInt(yearParam, 10);
  if (isNaN(year)) return null;
  const monthIndex = MONTH_NAMES.indexOf(
    monthParam.toLowerCase() as (typeof MONTH_NAMES)[number],
  );
  if (monthIndex === -1) return null;
  return { year, monthIndex };
}

interface ItemLike {
  when: string;
  type: "game" | "event";
  outcome?: string | null;
  category?: string;
}

/**
 * Sorts calendar items by datetime ascending; on ties, games come before
 * events (matches the visual hierarchy in the agenda).
 */
export function sortCalendarItems<T extends ItemLike>(items: T[]): T[] {
  return items.toSorted((a, b) => {
    const diff = new Date(a.when).getTime() - new Date(b.when).getTime();
    if (diff !== 0) return diff;
    if (a.type === "game" && b.type === "event") return -1;
    if (a.type === "event" && b.type === "game") return 1;
    return 0;
  });
}

/**
 * Filters items by the active filter pill. "all" returns the input
 * verbatim; everything else matches against the item's `category`.
 */
export function filterItemsByCategory<T extends ItemLike>(
  items: T[],
  filter: Filter,
): T[] {
  if (filter === "all") return items;
  return items.filter((item) => item.category === filter);
}

/**
 * Groups items by their YYYY-MM-DD date string (extracted from the
 * leading date portion of `when`). Used to render the agenda's per-day
 * sections in chronological order.
 */
export function groupItemsByDate<T extends ItemLike>(
  items: T[],
): Array<{ dateStr: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const dateStr = item.when.split("T")[0];
    const existing = map.get(dateStr);
    if (existing) {
      existing.push(item);
    } else {
      map.set(dateStr, [item]);
    }
  }
  return Array.from(map.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, dayItems]) => ({ dateStr, items: dayItems }));
}

/**
 * Groups items by the day-of-month number (1-31), used by the mini
 * calendar to know which days have fixtures/events.
 */
export function groupItemsByDay<T extends ItemLike>(
  items: T[],
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const day = new Date(item.when).getDate();
    const existing = map.get(day);
    if (existing) {
      existing.push(item);
    } else {
      map.set(day, [item]);
    }
  }
  return map;
}

/**
 * Summarises a month's items into win/loss/upcoming counts. Only games
 * with an outcome of "W" or "L" are counted as won/lost; upcoming counts
 * games with no outcome whose `when` is at or after `now`.
 */
export function summariseMonth<T extends ItemLike>(
  items: T[],
  now: Date,
): { won: number; lost: number; upcoming: number } {
  let won = 0;
  let lost = 0;
  let upcoming = 0;
  for (const item of items) {
    if (item.type !== "game") continue;
    if (item.outcome === "W") {
      won += 1;
    } else if (item.outcome === "L") {
      lost += 1;
    } else if (!item.outcome && !isBefore(new Date(item.when), now)) {
      upcoming += 1;
    }
  }
  return { won, lost, upcoming };
}

/**
 * Finds the index of the last "past" group in a chronologically-sorted
 * agenda — used to position the past/upcoming divider. Returns -1 if
 * there is no past content, or the past group is the very last (so a
 * trailing divider would be silly).
 *
 * Compares against the start-of-day of the supplied `today` (caller is
 * responsible for time-zone handling).
 */
export function findDividerIndex(
  grouped: Array<{ dateStr: string }>,
  today: Date,
): number {
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  let lastPastIdx = -1;
  for (let i = 0; i < grouped.length; i++) {
    const d = new Date(grouped[i].dateStr);
    if (d < startOfToday) lastPastIdx = i;
  }
  if (lastPastIdx >= 0 && lastPastIdx < grouped.length - 1) {
    return lastPastIdx;
  }
  return -1;
}
