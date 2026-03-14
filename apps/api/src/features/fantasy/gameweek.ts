/** Returns the current cricket season year. Season runs Apr-Sep. */
export function getCurrentSeason(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  // If Jan-Mar, still previous season; Apr onwards is current
  return month < 3 ? String(year - 1) : String(year);
}

export function getPreviousSeason(season?: string): string {
  const s = season ?? getCurrentSeason();
  return String(parseInt(s) - 1);
}

/**
 * Gameweeks are numbered 1-N for each season.
 * Each week runs Sunday-Saturday.
 * Week 1 starts on the first Sunday on or after April 1.
 */
export function getCurrentGameweek(season?: string): number {
  const s = season ?? getCurrentSeason();
  const year = parseInt(s);
  // Find first Sunday on or after Apr 1
  const apr1 = new Date(year, 3, 1); // Apr 1
  const dayOfWeek = apr1.getDay(); // 0=Sun
  const firstSunday = new Date(apr1);
  if (dayOfWeek !== 0) {
    firstSunday.setDate(apr1.getDate() + (7 - dayOfWeek));
  }

  const now = new Date();
  const diffMs = now.getTime() - firstSunday.getTime();
  if (diffMs < 0) return 1;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

export const BUDGET = 50; // sandwich budget
export const MAX_TRANSFERS_PER_GAMEWEEK = 3;
