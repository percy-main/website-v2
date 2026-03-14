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
  app.get(
    "/play-cricket/match/:matchId",
    async (request) => {
      const { matchId } = request.params as { matchId: string };
      return getMatchDetail(matchId);
    },
  );

  app.get(
    "/play-cricket/result-summary",
    async (request) => {
      const { matchId, season, ourTeamId } = parseQuery(
        request,
        resultSummarySchema,
      );
      return getResultSummary(matchId, season, ourTeamId);
    },
  );

  app.get(
    "/play-cricket/league-table",
    async (request) => {
      const { divisionId } = parseQuery(request, leagueTableSchema);
      return getLeagueTable(divisionId);
    },
  );

  app.get(
    "/play-cricket/teams",
    async () => {
      return getTeams();
    },
  );

  app.get(
    "/play-cricket/live-scores",
    async () => {
      return getLiveScores();
    },
  );

  app.get(
    "/play-cricket/player-career-stats",
    async (request) => {
      const { contentfulEntryId } = parseQuery(request, playerStatsSchema);
      return getPlayerCareerStats(contentfulEntryId);
    },
  );

  app.get(
    "/play-cricket/player-season-stats",
    async (request) => {
      const { contentfulEntryId, season } = parseQuery(
        request,
        playerSeasonStatsSchema,
      );
      return getPlayerSeasonStats(contentfulEntryId, season);
    },
  );
};
