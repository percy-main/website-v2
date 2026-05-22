import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requirePermission } from "../auth/middleware.ts";
import {
  leagueTableResponseSchema,
  leagueTableSchema,
  liveScoresResponseSchema,
  matchDetailResponseSchema,
  matchDetailSchema,
  playerCareerStatsResponseSchema,
  playerSeasonStatsResponseSchema,
  playerSeasonStatsSchema,
  playerStatsSchema,
  resultSummaryResponseSchema,
  resultSummarySchema,
  teamsResponseSchema,
  triggerSyncResponseSchema,
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
import { SyncNotConfiguredError, triggerSync } from "./trigger-sync.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const playCricketRoutes: FastifyPluginAsyncZod = async (app) => {
  const matchDetail = getMatchDetail(app.db);
  const resultSummary = getResultSummary(app.db);
  const leagueTable = getLeagueTable();
  const teams = getTeams(app.db);
  const liveScores = getLiveScores(app.db);
  const careerStats = getPlayerCareerStats(app.db);
  const seasonStats = getPlayerSeasonStats(app.db);
  const trigger = triggerSync(app.config);

  app.post(
    "/play-cricket/admin/sync",
    {
      preHandler: [requirePermission("matchday", "manage")],
      schema: {
        response: { 202: triggerSyncResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        const result = await trigger();
        reply.status(202);
        return result;
      } catch (err) {
        if (err instanceof SyncNotConfiguredError) {
          throw Object.assign(new Error(err.message), { statusCode: 503 });
        }
        throw err;
      }
    },
  );

  app.get(
    "/play-cricket/match/:matchId",
    {
      schema: {
        params: matchDetailSchema,
        response: { 200: matchDetailResponseSchema },
      },
    },
    async (request) => {
      const { matchId } = request.params;
      return await matchDetail(matchId);
    },
  );

  app.get(
    "/play-cricket/result-summary",
    {
      schema: {
        querystring: resultSummarySchema,
        response: { 200: resultSummaryResponseSchema },
      },
    },
    async (request) => {
      const { matchId, season, ourTeamId } = request.query;
      return await resultSummary(matchId, season, ourTeamId);
    },
  );

  app.get(
    "/play-cricket/league-table",
    {
      schema: {
        querystring: leagueTableSchema,
        response: { 200: leagueTableResponseSchema },
      },
    },
    async (request) => {
      const { divisionId } = request.query;
      return await leagueTable(divisionId);
    },
  );

  app.get(
    "/play-cricket/teams",
    {
      schema: {
        response: { 200: teamsResponseSchema },
      },
    },
    async () => {
      return await teams();
    },
  );

  app.get(
    "/play-cricket/live-scores",
    {
      schema: {
        response: { 200: liveScoresResponseSchema },
      },
    },
    async () => {
      return await liveScores();
    },
  );

  app.get(
    "/play-cricket/player-career-stats",
    {
      schema: {
        querystring: playerStatsSchema,
        response: { 200: playerCareerStatsResponseSchema },
      },
    },
    async (request) => {
      const { slug } = request.query;
      return await careerStats(slug);
    },
  );

  app.get(
    "/play-cricket/player-season-stats",
    {
      schema: {
        querystring: playerSeasonStatsSchema,
        response: { 200: playerSeasonStatsResponseSchema },
      },
    },
    async (request) => {
      const { slug, season, gameType } = request.query;
      return await seasonStats(slug, season, gameType);
    },
  );
};
