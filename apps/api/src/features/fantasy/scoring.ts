/** IDs of eligible teams for fantasy scoring */
export const ELIGIBLE_TEAM_IDS = ["1st-xi", "2nd-xi"];

/** Competition types that count for fantasy scoring */
export const LEAGUE_COMPETITION_TYPES = ["league", "cup"];

/** Slot distribution in a fantasy team */
export const SLOT_COUNTS = {
  batting: 4,
  bowling: 4,
  fielding: 3,
} as const;

/** Available chips (power-ups) */
export const CHIPS = ["triple_captain", "bench_boost", "wildcard"] as const;
export type ChipType = (typeof CHIPS)[number];

/** Chaos week rule types */
export const CHAOS_RULE_TYPES = [
  "reverse_scoring",
  "double_fielding",
  "captain_ban",
  "random_captain",
] as const;
