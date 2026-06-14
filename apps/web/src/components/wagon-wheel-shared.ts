import type { WagonWheelData } from "@/hooks/use-wagon-wheel.js";

export type Ball = WagonWheelData["innings"][number]["balls"][number];

export interface PlayerOption {
  id: number;
  name: string;
}

/**
 * Wrapper classes for an inline cricket result block (wagon wheel / worm
 * chart) embedded in editorial content. `wagon-wheel-surface` re-pins the
 * stone scale to its dark values locally (see app.css), so the dark-tuned
 * viewer renders correctly inside an otherwise light article.
 */
export const CRICKET_BLOCK_PANEL_CLASSES =
  "wagon-wheel-surface my-4 w-full overflow-hidden rounded-lg border border-stone-800 bg-stone-950 p-3 text-stone-100 sm:p-4";

export const COLORS = {
  dot: "#9ca3af",
  r1: "#5eb3ff",
  r4: "#4ade80",
  r6: "#fbbf24",
  neg: "#ef4444",
  wkt: "#ec4899",
};

export function runColor(b: Pick<Ball, "runsBat">): string {
  if (b.runsBat < 0) return COLORS.neg;
  if (b.runsBat === 0) return COLORS.dot;
  if (b.runsBat >= 6) return COLORS.r6;
  if (b.runsBat >= 4) return COLORS.r4;
  return COLORS.r1;
}

export function dismissalText(b: Ball): string {
  // batterName / bowlerName can be null when the RV player has no PC
  // external_id (placeholder ids like -101 / -102 don't get stored in
  // rv_player_mapping). Fall back to parsing the canonical
  // " <bowler> to <batter>: ..." prefix in lDesc so the tooltip never
  // shows "Batter out — bowler bowling".
  const parsed = /^\s*(.+?)\s+to\s+(.+?):/.exec(b.lDesc);
  const batter = b.batterName ?? parsed?.[2] ?? "Batter";
  const bowler = b.bowlerName ?? parsed?.[1] ?? "bowler";
  return `${batter} out — ${bowler} bowling`;
}

// Distinct players (by RV id) appearing in an innings, for the filter
// dropdowns. Balls with a null RV id (placeholder players with no PC mapping)
// can't be filtered individually, so they're omitted from the options.
export function playerOptions(
  balls: Ball[],
  pick: "bat" | "bowl",
): PlayerOption[] {
  const byId = new Map<number, string>();
  for (const b of balls) {
    const id = pick === "bat" ? b.batterRvId : b.bowlerRvId;
    if (id == null) continue;
    // batterName / bowlerName can be null when the RV player has no PC
    // external_id (placeholder ids like -101 / -102 aren't in
    // rv_player_mapping), which would surface as "#-101" in the dropdown.
    // Fall back to parsing the canonical "<bowler> to <batter>: ..." prefix
    // in lDesc, as dismissalText does. Re-resolve a stored "#id" placeholder
    // if a later ball yields a real name.
    const existing = byId.get(id);
    if (existing === undefined || existing.startsWith("#")) {
      const name = pick === "bat" ? b.batterName : b.bowlerName;
      const parsed = /^\s*(.+?)\s+to\s+(.+?):/.exec(b.lDesc);
      const fromDesc = pick === "bat" ? parsed?.[2] : parsed?.[1];
      byId.set(id, name ?? fromDesc ?? `#${id}`);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
