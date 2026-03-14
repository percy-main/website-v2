import type { FastifyPluginAsync } from "fastify";
import { parseQuery } from "../../lib/validation.js";
import {
  resultSummarySchema,
  leagueTableSchema,
  playerStatsSchema,
  playerSeasonStatsSchema,
} from "./schemas.js";
import {
  getMatchDetail,
  getResultSummary,
  getLeagueTable,
  getTeams,
  getLiveScores,
  getPlayerCareerStats,
  getPlayerSeasonStats,
} from "./service.js";

export const playCricketRoutes: FastifyPluginAsync = async (app) => {
  const matchDetail = getMatchDetail(app.db);
  const resultSummary = getResultSummary(app.db);
  const leagueTable = getLeagueTable();
  const teams = getTeams(app.db);
  const liveScores = getLiveScores(app.db);
  const careerStats = getPlayerCareerStats(app.db);
  const seasonStats = getPlayerSeasonStats(app.db);

  app.get(
    "/play-cricket/match/:matchId",
    async (request) => {
      const { matchId } = request.params as { matchId: string };
      return matchDetail(matchId);
    },
  );

  app.get(
    "/play-cricket/result-summary",
    async (request) => {
      const { matchId, season, ourTeamId } = parseQuery(
        request,
        resultSummarySchema,
      );
      return resultSummary(matchId, season, ourTeamId);
    },
  );

  app.get(
    "/play-cricket/league-table",
    async (request) => {
      const { divisionId } = parseQuery(request, leagueTableSchema);
      return leagueTable(divisionId);
    },
  );

  app.get(
    "/play-cricket/teams",
    async () => {
      return teams();
    },
  );

  app.get(
    "/play-cricket/live-scores",
    async () => {
      return liveScores();
    },
  );

  app.get(
    "/play-cricket/player-career-stats",
    async (request) => {
      const { contentfulEntryId } = parseQuery(request, playerStatsSchema);
      return careerStats(contentfulEntryId);
    },
  );

  app.get(
    "/play-cricket/player-season-stats",
    async (request) => {
      const { contentfulEntryId, season } = parseQuery(
        request,
        playerSeasonStatsSchema,
      );
      return seasonStats(contentfulEntryId, season);
    },
  );
};
