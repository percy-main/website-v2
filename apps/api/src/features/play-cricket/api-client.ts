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

/**
 * Static-message error so NR Errors view groups all Play Cricket
 * failures together (path / status / bodyPreview live as properties,
 * not in the message string). The original parse error is chained
 * via `cause` when wrapping a JSON.parse failure.
 */
export class PlayCricketApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly bodyPreview: string,
    options?: { cause?: unknown },
  ) {
    super("play_cricket_api_error", options);
    this.name = "PlayCricketApiError";
  }
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
    throw new PlayCricketApiError(path, res.status, body.slice(0, 500));
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (err) {
    throw new PlayCricketApiError(path, res.status, body.slice(0, 500), {
      cause: err,
    });
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
     * Fetch a season's fixtures for any club, using their Play-Cricket
     * site_id. Empirically our token can read other clubs' sites — the API
     * doesn't enforce per-token site scoping for /matches.json. The
     * `home_club_id` / `away_club_id` fields in every match summary row
     * are the same number as `site_id` for that club, so the agent picks
     * up an opposition's site_id from any prior match against us.
     *
     * Optionally pass `teamId` (= home_team_id / away_team_id) to scope
     * to a single XI (1st, 2nd, etc.) — useful when scouting a club whose
     * 1st and 2nd XI play in different divisions.
     */
    async getMatchesForSite(siteId: string, season: number, teamId?: string) {
      const params: Record<string, string> = {
        site_id: siteId,
        season: String(season),
      };
      if (teamId) params.team_id = teamId;
      const json = await fetchPlayCricket(config, "/matches.json", params);
      return GetMatchSummaryResponse.parse(json);
    },

    /**
     * Played matches only, with innings totals and bonus points — much
     * cheaper than fetching N match details when you just want results
     * and form. Like getMatchesForSite, our token works against other
     * clubs' site_ids.
     */
    async getResultSummaryForSite(siteId: string, season: number) {
      return fetchPlayCricket(config, "/result_summary.json", {
        site_id: siteId,
        season: String(season),
      });
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
