import {
  GetMatchDetailResponse,
  GetMatchSummaryResponse,
  GetPlayersResponse,
  GetTeamsResponse,
} from "./api-schemas.js";

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
      const json = await fetchPlayCricket(
        config,
        `/match_detail/${matchId}.json`,
      );
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

    async getMatchScorecard(matchId: string) {
      return fetchPlayCricket(config, `/match_detail/${matchId}.json`);
    },
  };
}

export type PlayCricketApiClient = ReturnType<typeof createApiClient>;

// Standalone functions for backward compat with existing service.ts
// These read from process.env — used only during route wiring, not in services
export async function getMatchDetail(matchId: string): Promise<unknown> {
  const config = getConfigFromEnv();
  return createApiClient(config).getMatchScorecard(matchId);
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
