/**
 * Pure helpers for the fantasy page.
 *
 * Extracted so they can be unit-tested without React/DOM. The page
 * component still owns react-query and URL-state plumbing.
 */

export type SquadSlot = "batting" | "bowling" | "allrounder";

/**
 * Sort order for squad slot types — used in TeamView to render batting,
 * then bowling, then all-rounders. Mirrors the original inline map.
 */
export const SLOT_ORDER: Record<SquadSlot, number> = {
  batting: 0,
  bowling: 1,
  allrounder: 2,
};

const UNKNOWN_SLOT_RANK = 3;

/**
 * Stable sort of a squad by slot type. Mirrors the previous inline
 * `data.players.toSorted(...)` exactly — players with an unknown slot
 * type sort to the end.
 */
export function sortSquadBySlot<P extends { slotType: string }>(
  players: readonly P[],
): P[] {
  return players.toSorted(
    (a, b) =>
      ((SLOT_ORDER as Record<string, number>)[a.slotType] ??
        UNKNOWN_SLOT_RANK) -
      ((SLOT_ORDER as Record<string, number>)[b.slotType] ?? UNKNOWN_SLOT_RANK),
  );
}

/**
 * Renders a player's sandwich cost as a string of sandwich emoji. Negative
 * or non-finite costs render as the empty string. Undefined costs (the API
 * may omit the field) are treated as zero.
 */
export function formatSandwichCost(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return "";
  // Cap at a sensible upper bound — the BE clamps too, but defending the
  // FE from a runaway value is cheap.
  const clamped = Math.min(Math.floor(cost), 20);
  return "🥪".repeat(clamped);
}

/**
 * Parses a `gw` URL search param into a gameweek number, or undefined
 * when missing/empty/non-numeric.
 */
export function parseGameweekParam(
  value: string | null | undefined,
): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses a `team` URL search param into a numeric team id, or null when
 * missing/empty/non-numeric.
 */
export function parseTeamIdParam(
  value: string | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a `player` URL search param. The play-cricket id is opaque, so
 * just trims to "string-or-null".
 */
export function parsePlayerIdParam(
  value: string | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  return value;
}

interface TeamPointsRow {
  isCaptain: boolean;
  seasonPoints: number;
}

/**
 * Returns the season-points total for a squad, doubling the captain. The
 * server side computes the same number; this exists for client-side
 * checks (e.g. the "your team" preview, future "compare two teams" UI).
 *
 * If multiple players are flagged as captain, all are doubled — the BE
 * guarantees only one captain, so this is a robust fallback rather than
 * a deliberate feature.
 */
export function calculateTeamPoints(squad: readonly TeamPointsRow[]): number {
  let total = 0;
  for (const p of squad) {
    total += p.isCaptain ? p.seasonPoints * 2 : p.seasonPoints;
  }
  return total;
}
