import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAuth,
  requirePermission,
} from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import { calculateFantasyScores } from "./calculate-scores.ts";
import { getCurrentSeason } from "./gameweek.ts";
import {
  adminListPlayersResponseSchema,
  calculateCostsResponseSchema,
  calculateCostsSchema,
  calculateScoresResponseSchema,
  calculateScoresSchema,
  chaosWeekPublicResponseSchema,
  chaosWeekPublicSchema,
  chipSchema,
  chipStatusResponseSchema,
  createChaosWeekResponseSchema,
  createChaosWeekSchema,
  deleteChaosWeekSchema,
  eligiblePlayersResponseSchema,
  gameweekDetailResponseSchema,
  gameweekDetailSchema,
  highlightsResponseSchema,
  highlightsSchema,
  listChaosWeeksResponseSchema,
  listPlayersSchema,
  listTeamsResponseSchema,
  myTeamResponseSchema,
  ownershipOverviewResponseSchema,
  playerHistoryResponseSchema,
  playerHistorySchema,
  playerLeaderboardResponseSchema,
  populatePlayersResponseSchema,
  preSeasonStatsResponseSchema,
  recentTransfersResponseSchema,
  recentTransfersSchema,
  sandwichEfficiencyResponseSchema,
  sandwichEfficiencySchema,
  saveTeamResponseSchema,
  saveTeamSchema,
  seasonLeaderboardResponseSchema,
  seasonSchema,
  successResponseSchema,
  teamDetailResponseSchema,
  teamIdSchema,
  teamShareDataResponseSchema,
  toggleEligibilityResponseSchema,
  toggleEligibilitySchema,
  transferWindowResponseSchema,
  weeklyLeaderboardResponseSchema,
  weeklyLeaderboardSchema,
} from "./schemas.ts";
import {
  activateChip,
  calculateSandwichCosts,
  createChaosWeek,
  deactivateChip,
  deleteChaosWeek,
  getChaosWeekPublic,
  getChipStatus,
  getEligiblePlayers,
  getGameweekDetail,
  getGameweekHighlights,
  getMyTeam,
  getOwnershipOverview,
  getPlayerHistory,
  getPlayerLeaderboard,
  getPreSeasonStats,
  getRecentTransfers,
  getSandwichEfficiency,
  getSeasonLeaderboard,
  getTeam,
  getTeamShareData,
  getTransferWindow,
  getWeeklyLeaderboard,
  listChaosWeeks,
  listPlayers,
  listTeams,
  populatePlayers,
  saveTeam,
  toggleEligibility,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const fantasyRoutes: FastifyPluginAsyncZod = async (app) => {
  const playCricketApi =
    app.config.PLAY_CRICKET_API_TOKEN && app.config.PLAY_CRICKET_SITE_ID
      ? createApiClient({
          apiToken: app.config.PLAY_CRICKET_API_TOKEN,
          siteId: app.config.PLAY_CRICKET_SITE_ID,
        })
      : undefined;

  // Wire up service factories
  const eligible = getEligiblePlayers(app.db);
  const myTeam = getMyTeam(app.db);
  const save = saveTeam(app.db);
  const list = listPlayers(app.db);
  const toggle = toggleEligibility(app.db);
  const populate = populatePlayers(app.db, playCricketApi);
  const calcCosts = calculateSandwichCosts(app.db);
  const calcScores = calculateFantasyScores(app.db);
  const transferWindow = getTransferWindow();
  const chaosWeekPub = getChaosWeekPublic(app.db);
  const preSeasonStats = getPreSeasonStats(app.db);
  const ownershipOverview = getOwnershipOverview(app.db);
  const sandwichEff = getSandwichEfficiency(app.db);
  const highlights = getGameweekHighlights(app.db);
  const seasonBoard = getSeasonLeaderboard(app.db);
  const weeklyBoard = getWeeklyLeaderboard(app.db);
  const playerBoard = getPlayerLeaderboard(app.db);
  const teams = listTeams(app.db);
  const teamDetail = getTeam(app.db);
  const gwDetail = getGameweekDetail(app.db);
  const playerHist = getPlayerHistory(app.db);
  const chipStatus = getChipStatus(app.db);
  const chipActivate = activateChip(app.db);
  const chipDeactivate = deactivateChip(app.db);
  const chaosWeeksList = listChaosWeeks(app.db);
  const chaosWeekCreate = createChaosWeek(app.db);
  const chaosWeekDelete = deleteChaosWeek(app.db);
  const shareData = getTeamShareData(app.db);
  const recentTransfers = getRecentTransfers(app.db);

  // --- Public routes ---

  app.get(
    "/fantasy/transfer-window",
    {
      schema: {
        querystring: seasonSchema,
        response: { 200: transferWindowResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      // transferWindow is sync; wrap to satisfy return await pattern
      return await Promise.resolve(transferWindow(season));
    },
  );

  app.get(
    "/fantasy/transfer-news",
    {
      schema: {
        querystring: recentTransfersSchema,
        response: { 200: recentTransfersResponseSchema },
      },
    },
    async (request) => {
      const { season, limit } = request.query;
      return await recentTransfers(season, limit);
    },
  );

  app.get(
    "/fantasy/chaos-week",
    {
      schema: {
        querystring: chaosWeekPublicSchema,
        response: { 200: chaosWeekPublicResponseSchema },
      },
    },
    async (request) => {
      const { season, gameweek } = request.query;
      return await chaosWeekPub(season, gameweek);
    },
  );

  app.get(
    "/fantasy/stats/pre-season",
    {
      schema: {
        querystring: seasonSchema,
        response: { 200: preSeasonStatsResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      return await preSeasonStats(season);
    },
  );

  app.get(
    "/fantasy/stats/ownership",
    {
      schema: {
        querystring: seasonSchema,
        response: { 200: ownershipOverviewResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      return await ownershipOverview(season);
    },
  );

  app.get(
    "/fantasy/stats/sandwich-efficiency",
    {
      schema: {
        querystring: sandwichEfficiencySchema,
        response: { 200: sandwichEfficiencyResponseSchema },
      },
    },
    async (request) => {
      const { season, limit } = request.query;
      return await sandwichEff(season, limit);
    },
  );

  app.get(
    "/fantasy/highlights",
    {
      schema: {
        querystring: highlightsSchema,
        response: { 200: highlightsResponseSchema },
      },
    },
    async (request) => {
      const { season, gameweek } = request.query;
      return await highlights(season, gameweek);
    },
  );

  app.get(
    "/fantasy/leaderboard/season",
    {
      schema: {
        querystring: seasonSchema,
        response: { 200: seasonLeaderboardResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      return await seasonBoard(season);
    },
  );

  app.get(
    "/fantasy/leaderboard/weekly",
    {
      schema: {
        querystring: weeklyLeaderboardSchema,
        response: { 200: weeklyLeaderboardResponseSchema },
      },
    },
    async (request) => {
      const { season, gameweek } = request.query;
      return await weeklyBoard(season, gameweek);
    },
  );

  app.get(
    "/fantasy/leaderboard/players",
    {
      schema: {
        querystring: seasonSchema,
        response: { 200: playerLeaderboardResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      return await playerBoard(season);
    },
  );

  app.get(
    "/fantasy/teams",
    {
      schema: {
        querystring: seasonSchema,
        response: { 200: listTeamsResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      return await teams(season);
    },
  );

  app.get(
    "/fantasy/teams/:teamId",
    {
      schema: {
        params: teamIdSchema,
        response: { 200: teamDetailResponseSchema },
      },
    },
    async (request) => {
      const { teamId } = request.params;
      return await teamDetail(teamId);
    },
  );

  app.get(
    "/fantasy/teams/:teamId/gameweek/:gameweek",
    {
      schema: {
        params: gameweekDetailSchema,
        querystring: seasonSchema,
        response: { 200: gameweekDetailResponseSchema },
      },
    },
    async (request) => {
      const { teamId, gameweek } = request.params;
      const { season } = request.query;
      return await gwDetail(teamId, gameweek, season);
    },
  );

  app.get(
    "/fantasy/players/:playCricketId/history",
    {
      schema: {
        params: playerHistorySchema,
        querystring: seasonSchema,
        response: { 200: playerHistoryResponseSchema },
      },
    },
    async (request) => {
      const { playCricketId } = request.params;
      const { season } = request.query;
      return await playerHist(playCricketId, season);
    },
  );

  // --- Authenticated routes ---

  app.get(
    "/fantasy/players",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: seasonSchema,
        response: { 200: eligiblePlayersResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      return await eligible(season);
    },
  );

  app.get(
    "/fantasy/team",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: seasonSchema,
        response: { 200: myTeamResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { season } = request.query;
      return await myTeam(user.id, season);
    },
  );

  app.post(
    "/fantasy/team",
    {
      preHandler: [requireAuth],
      schema: {
        body: saveTeamSchema,
        response: { 200: saveTeamResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { season, players } = request.body;
      return await save(user.id, players, season);
    },
  );

  app.get(
    "/fantasy/chip",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: seasonSchema,
        response: { 200: chipStatusResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { season } = request.query;
      return await chipStatus(user.id, season);
    },
  );

  app.post(
    "/fantasy/chip",
    {
      preHandler: [requireAuth],
      schema: {
        body: chipSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { chipType, season } = request.body;
      return await chipActivate(user.id, chipType, season);
    },
  );

  app.post(
    "/fantasy/chip/deactivate",
    {
      preHandler: [requireAuth],
      schema: {
        body: chipSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { chipType, season } = request.body;
      return await chipDeactivate(user.id, chipType, season);
    },
  );

  app.get(
    "/fantasy/team/share",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: seasonSchema,
        response: { 200: teamShareDataResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { season } = request.query;
      const data = await shareData(user.id, season);
      if (!data) {
        const error = new Error("Team not found") as Error & {
          statusCode: number;
        };
        error.statusCode = 404;
        throw error;
      }
      return data;
    },
  );

  // --- Admin routes ---

  app.get(
    "/fantasy/admin/players",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        querystring: listPlayersSchema,
        response: { 200: adminListPlayersResponseSchema },
      },
    },
    async (request) => {
      const { search } = request.query;
      return await list(search);
    },
  );

  app.post(
    "/fantasy/admin/toggle-eligibility",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        body: toggleEligibilitySchema,
        response: { 200: toggleEligibilityResponseSchema },
      },
    },
    async (request) => {
      const { playCricketId, eligible: isEligible } = request.body;
      return await toggle(playCricketId, isEligible);
    },
  );

  app.post(
    "/fantasy/admin/populate-players",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        response: { 200: populatePlayersResponseSchema },
      },
    },
    async () => {
      return await populate();
    },
  );

  app.post(
    "/fantasy/admin/calculate-costs",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        body: calculateCostsSchema,
        response: { 200: calculateCostsResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.body;
      return await calcCosts(season);
    },
  );

  app.post(
    "/fantasy/admin/calculate-scores",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        body: calculateScoresSchema,
        response: { 200: calculateScoresResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.body;
      return await calcScores(season ?? getCurrentSeason());
    },
  );

  app.get(
    "/fantasy/admin/chaos-weeks",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        querystring: seasonSchema,
        response: { 200: listChaosWeeksResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      return await chaosWeeksList(season);
    },
  );

  app.post(
    "/fantasy/admin/chaos-weeks",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        body: createChaosWeekSchema,
        response: { 200: createChaosWeekResponseSchema },
      },
    },
    async (request) => {
      return await chaosWeekCreate(request.body);
    },
  );

  app.delete(
    "/fantasy/admin/chaos-weeks",
    {
      preHandler: [requirePermission("fantasy", "manage")],
      schema: {
        body: deleteChaosWeekSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.body;
      return await chaosWeekDelete(id);
    },
  );
};
