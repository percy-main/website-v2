const API_BASE = "https://www.play-cricket.com/api/v2";

async function fetchPlayCricket(
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const token = process.env.PLAY_CRICKET_API_TOKEN;
  if (!token) throw new Error("PLAY_CRICKET_API_TOKEN not set");

  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("api_token", token);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Play Cricket API error: ${res.status}`);
  return res.json() as Promise<unknown>;
}

export async function getMatchDetail(matchId: string): Promise<unknown> {
  return fetchPlayCricket(`/match_detail/${matchId}.json`);
}

export async function getResultSummary(siteId: string, season: number): Promise<unknown> {
  return fetchPlayCricket(`/result_summary/${siteId}.json`, {
    season: String(season),
  });
}

export async function getLeagueTable(divisionId: string): Promise<unknown> {
  return fetchPlayCricket(`/league_table/${divisionId}.json`);
}

export async function getTeams(siteId: string): Promise<unknown> {
  return fetchPlayCricket(`/teams.json`, { site_id: siteId });
}

export async function getMatchScorecard(matchId: string): Promise<unknown> {
  return fetchPlayCricket(`/match_detail/${matchId}.json`);
}
