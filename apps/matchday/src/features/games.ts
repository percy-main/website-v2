import type { ApiResponse } from "@/lib/api-client.js";

/**
 * Game derived from the OpenAPI spec — single source of truth so a
 * server-side rename (e.g. `home` → `isHome`) breaks the compile rather
 * than silently misrendering.
 */
export type Game = ApiResponse<"/api/games">[number];
export type GameDetail = ApiResponse<"/api/games/{matchId}">;

/** True when the match has a recorded result (i.e. it's been played). */
export function played(g: Game | GameDetail): boolean {
  return g.outcome !== null;
}

/**
 * Collapse the nested opposition.club / opposition.team pair down to the
 * single label cards want — "Tynemouth 2nd XI" when both are present,
 * just the club name when the team name duplicates it or is missing.
 */
export function oppositionName(g: Game | GameDetail): string {
  const club = g.opposition.club.name;
  const team = g.opposition.team.name;
  if (!team || team === club) return club;
  return `${club} ${team}`;
}
