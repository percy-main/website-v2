import {
  GetMatchDetailResponse,
  GetMatchSummaryResponse,
  GetPlayersResponse,
  GetTeamsResponse,
} from "./api-schemas.ts";

const API_BASE = "https://www.play-cricket.com/api/v2";

export interface PlayCricketApiConfig {
  apiToken: string;
  siteId: string;
}

async function fetchPlayCricket(
  config: PlayCricketApiConfig,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("api_token", config.apiToken);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Play Cricket API error (HTTP ${res.status}): ${body.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(
      `Play Cricket API returned non-JSON (HTTP ${res.status}): ${body.slice(0, 500)}`,
    );
  }
}

export function createApiClient(config: PlayCricketApiConfig) {
  return {
    async getMatchDetail(matchId: string) {
      const json = await fetchPlayCricket(config, "/match_detail.json", {
        match_id: matchId,
      });
      return GetMatchDetailResponse.parse(json);
    },

    async getMatchesSummary(season: number) {
      const json = await fetchPlayCricket(config, "/matches.json", {
        site_id: config.siteId,
        season: String(season),
      });
      return GetMatchSummaryResponse.parse(json);
    },

    async getPlayers() {
      const json = await fetchPlayCricket(
        config,
        `/sites/${config.siteId}/players.json`,
        { include_everyone: "yes" },
      );
      return GetPlayersResponse.parse(json);
    },

    async getTeams() {
      const json = await fetchPlayCricket(
        config,
        `/sites/${config.siteId}/teams.json`,
      );
      return GetTeamsResponse.parse(json);
    },

    async getLeagueTable(divisionId: string) {
      return fetchPlayCricket(config, `/league_table.json`, {
        division_id: divisionId,
      });
    },

    /**
     * Fetch matches involving a specific club (any team, home or away). Used
     * by Scout to scout opposition that Percy Main hasn't necessarily played
     * — every match summary row from /matches.json carries home_club_id /
     * away_club_id, so the agent can pick a club_id from a previous result
     * and pivot to that club's full fixture list.
     */
    async getMatchesForClub(clubId: string, season: number) {
      const json = await fetchPlayCricket(config, "/matches.json", {
        club_id: clubId,
        season: String(season),
      });
      return GetMatchSummaryResponse.parse(json);
    },
  };
}

export type PlayCricketApiClient = ReturnType<typeof createApiClient>;

// Standalone functions for backward compat with existing service.ts
// These read from process.env — used only during route wiring, not in services
export async function getMatchDetail(matchId: string): Promise<unknown> {
  const config = getConfigFromEnv();
  return createApiClient(config).getMatchDetail(matchId);
}

export async function getLeagueTable(divisionId: string): Promise<unknown> {
  const config = getConfigFromEnv();
  return createApiClient(config).getLeagueTable(divisionId);
}

function getConfigFromEnv(): PlayCricketApiConfig {
  const apiToken = process.env.PLAY_CRICKET_API_TOKEN;
  const siteId = process.env.PLAY_CRICKET_SITE_ID;
  if (!apiToken) throw new Error("PLAY_CRICKET_API_TOKEN not set");
  if (!siteId) throw new Error("PLAY_CRICKET_SITE_ID not set");
  return { apiToken, siteId };
}
