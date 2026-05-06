import type { ScoutReportReference } from "@percy-main/shared";

/**
 * Per-run citation accumulator. cite_match / cite_player_stats invocations
 * during the report agent's loop go in here (deduped on URL); the runReport
 * pipeline pulls a snapshot at the end of the run and writes it into
 * payload.references for the PDF's references page.
 *
 * cite_fact has no external URL — it's a chat-mode UI primitive — so it
 * does not feed this accumulator.
 *
 * The URL builders mirror apps/web/src/pages/scout/message-view.tsx so the
 * references page links to the same pages the chat-mode citation chips do.
 */

const PERCY_MAIN_HOSTNAME = "percymain.play-cricket.com";
const PERCY_MAIN_CLUB_ID = "134";

export interface MatchCitationInput {
  matchId: string;
  matchDate?: string;
  homeTeam?: string;
  awayTeam?: string;
  groundName?: string;
  competition?: string;
  result?: string;
}

export interface PlayerStatsCitationInput {
  playerId: string;
  playerName: string;
  statType: "batting" | "bowling" | "fielding";
  season?: number;
  teamId?: string;
  gameType?: string;
}

function buildMatchUrl(input: MatchCitationInput): string {
  return `https://${PERCY_MAIN_HOSTNAME}/website/results/${encodeURIComponent(input.matchId)}`;
}

function buildPlayerStatsUrl(input: PlayerStatsCitationInput): string {
  const params = new URLSearchParams();
  params.set("club_id", PERCY_MAIN_CLUB_ID);
  params.set("tab", input.statType);
  if (input.teamId) params.set("team_id", input.teamId);
  if (input.gameType) params.set("game_type", input.gameType);
  return `https://${PERCY_MAIN_HOSTNAME}/player_stats/${input.statType}/${encodeURIComponent(input.playerId)}?${params.toString()}`;
}

function matchLabel(input: MatchCitationInput): string {
  const teams =
    input.homeTeam && input.awayTeam
      ? `${input.homeTeam} v ${input.awayTeam}`
      : null;
  const date = input.matchDate;
  if (teams && date) return `${teams} (${date})`;
  if (teams) return teams;
  if (date) return `Match on ${date}`;
  return `Match ${input.matchId}`;
}

function playerStatsLabel(input: PlayerStatsCitationInput): string {
  const season = input.season ? ` ${input.season}` : "";
  return `${input.playerName} — ${input.statType}${season}`;
}

export class CitationAccumulator {
  // Keyed by URL so different cite calls for the same match/player de-dupe.
  private byUrl = new Map<string, ScoutReportReference>();

  recordMatch(input: MatchCitationInput): void {
    const url = buildMatchUrl(input);
    if (this.byUrl.has(url)) return;
    this.byUrl.set(url, { url, label: matchLabel(input) });
  }

  recordPlayerStats(input: PlayerStatsCitationInput): void {
    const url = buildPlayerStatsUrl(input);
    if (this.byUrl.has(url)) return;
    this.byUrl.set(url, { url, label: playerStatsLabel(input) });
  }

  snapshot(): ScoutReportReference[] {
    return Array.from(this.byUrl.values());
  }

  size(): number {
    return this.byUrl.size;
  }
}
