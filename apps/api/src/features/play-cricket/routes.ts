import type { FastifyPluginAsync } from "fastify";
import { parseQuery } from "../../lib/validation.ts";
import {
  leagueTableSchema,
  playerSeasonStatsSchema,
  playerStatsSchema,
  resultSummarySchema,
} from "./schemas.ts";
import {
  getLeagueTable,
  getLiveScores,
  getMatchDetail,
  getPlayerCareerStats,
  getPlayerSeasonStats,
  getResultSummary,
  getTeams,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const playCricketRoutes: FastifyPluginAsync = async (app) => {
  const matchDetail = getMatchDetail(app.db);
  const resultSummary = getResultSummary(app.db);
  const leagueTable = getLeagueTable();
  const teams = getTeams(app.db);
  const liveScores = getLiveScores(app.db);
  const careerStats = getPlayerCareerStats(app.db);
  const seasonStats = getPlayerSeasonStats(app.db);

  app.get("/play-cricket/match/:matchId", async (request) => {
    const { matchId } = request.params as { matchId: string };
    return await matchDetail(matchId);
  });

  app.get("/play-cricket/result-summary", async (request) => {
    const { matchId, season, ourTeamId } = parseQuery(
      request,
      resultSummarySchema,
    );
    return await resultSummary(matchId, season, ourTeamId);
  });

  app.get("/play-cricket/league-table", async (request) => {
    const { divisionId } = parseQuery(request, leagueTableSchema);
    return await leagueTable(divisionId);
  });

  app.get("/play-cricket/teams", async () => {
    return await teams();
  });

  app.get("/play-cricket/live-scores", async () => {
    return await liveScores();
  });

  app.get("/play-cricket/player-career-stats", async (request) => {
    const { contentfulEntryId } = parseQuery(request, playerStatsSchema);
    return await careerStats(contentfulEntryId);
  });

  app.get("/play-cricket/player-season-stats", async (request) => {
    const { contentfulEntryId, season } = parseQuery(
      request,
      playerSeasonStatsSchema,
    );
    return await seasonStats(contentfulEntryId, season);
  });
};
