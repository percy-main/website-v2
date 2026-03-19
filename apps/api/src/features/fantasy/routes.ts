import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.js";
import {
  getAuthSession,
  requireAuth,
  requireRole,
} from "../auth/middleware.js";
import { calculateFantasyScores } from "./calculate-scores.js";
import { getCurrentSeason } from "./gameweek.js";
import {
  calculateCostsSchema,
  calculateScoresSchema,
  chaosWeekPublicSchema,
  chipSchema,
  createChaosWeekSchema,
  deleteChaosWeekSchema,
  gameweekDetailSchema,
  highlightsSchema,
  listPlayersSchema,
  playerHistorySchema,
  sandwichEfficiencySchema,
  saveTeamSchema,
  seasonSchema,
  teamIdSchema,
  toggleEligibilitySchema,
  weeklyLeaderboardSchema,
} from "./schemas.js";
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
  getSandwichEfficiency,
  getSeasonLeaderboard,
  getSeasonTimeline,
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
} from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const fantasyRoutes: FastifyPluginAsync = async (app) => {
  // Wire up service factories
  const eligible = getEligiblePlayers(app.db);
  const myTeam = getMyTeam(app.db);
  const save = saveTeam(app.db);
  const list = listPlayers(app.db);
  const toggle = toggleEligibility(app.db);
  const populate = populatePlayers(app.db);
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
  const timeline = getSeasonTimeline(app.db);
  const playerHist = getPlayerHistory(app.db);
  const chipStatus = getChipStatus(app.db);
  const chipActivate = activateChip(app.db);
  const chipDeactivate = deactivateChip(app.db);
  const chaosWeeksList = listChaosWeeks(app.db);
  const chaosWeekCreate = createChaosWeek(app.db);
  const chaosWeekDelete = deleteChaosWeek(app.db);
  const shareData = getTeamShareData(app.db);

  // --- Public routes ---

  app.get("/fantasy/transfer-window", async (request) => {
    const { season } = parseQuery(request, seasonSchema);
    // transferWindow is sync; wrap to satisfy return await pattern
    return await Promise.resolve(transferWindow(season));
  });

  app.get("/fantasy/chaos-week", async (request) => {
    const { season, gameweek } = parseQuery(request, chaosWeekPublicSchema);
    return await chaosWeekPub(season, gameweek);
  });

  app.get("/fantasy/stats/pre-season", async (request) => {
    const { season } = parseQuery(request, seasonSchema);
    return await preSeasonStats(season);
  });

  app.get("/fantasy/stats/ownership", async (request) => {
    const { season } = parseQuery(request, seasonSchema);
    return await ownershipOverview(season);
  });

  app.get("/fantasy/stats/sandwich-efficiency", async (request) => {
    const { season, limit } = parseQuery(request, sandwichEfficiencySchema);
    return await sandwichEff(season, limit);
  });

  app.get("/fantasy/highlights", async (request) => {
    const { season, gameweek } = parseQuery(request, highlightsSchema);
    return await highlights(season, gameweek);
  });

  app.get("/fantasy/leaderboard/season", async (request) => {
    const { season } = parseQuery(request, seasonSchema);
    return await seasonBoard(season);
  });

  app.get("/fantasy/leaderboard/weekly", async (request) => {
    const { season, gameweek } = parseQuery(request, weeklyLeaderboardSchema);
    return await weeklyBoard(season, gameweek);
  });

  app.get("/fantasy/leaderboard/players", async (request) => {
    const { season } = parseQuery(request, seasonSchema);
    return await playerBoard(season);
  });

  app.get("/fantasy/teams", async (request) => {
    const { season } = parseQuery(request, seasonSchema);
    return await teams(season);
  });

  app.get("/fantasy/teams/:teamId", async (request) => {
    const { teamId } = parseParams(request, teamIdSchema);
    return await teamDetail(teamId);
  });

  app.get("/fantasy/teams/:teamId/timeline", async (request) => {
    const { teamId } = parseParams(request, teamIdSchema);
    const { season } = parseQuery(request, seasonSchema);
    return await timeline(teamId, season);
  });

  app.get("/fantasy/teams/:teamId/gameweek/:gameweek", async (request) => {
    const { teamId, gameweek } = parseParams(request, gameweekDetailSchema);
    const { season } = parseQuery(request, seasonSchema);
    return await gwDetail(teamId, gameweek, season);
  });

  app.get("/fantasy/players/:playCricketId/history", async (request) => {
    const { playCricketId } = parseParams(request, playerHistorySchema);
    const { season } = parseQuery(request, seasonSchema);
    return await playerHist(playCricketId, season);
  });

  // --- Authenticated routes ---

  app.get(
    "/fantasy/players",
    { preHandler: [requireAuth] },
    async (request) => {
      const { season } = parseQuery(request, seasonSchema);
      return await eligible(season);
    },
  );

  app.get("/fantasy/team", { preHandler: [requireAuth] }, async (request) => {
    const { user } = getAuthSession(request);
    const { season } = parseQuery(request, seasonSchema);
    return await myTeam(user.id, season);
  });

  app.post("/fantasy/team", { preHandler: [requireAuth] }, async (request) => {
    const { user } = getAuthSession(request);
    const { season, players } = parseBody(request, saveTeamSchema);
    return await save(user.id, players, season);
  });

  app.get("/fantasy/chip", { preHandler: [requireAuth] }, async (request) => {
    const { user } = getAuthSession(request);
    const { season } = parseQuery(request, seasonSchema);
    return await chipStatus(user.id, season);
  });

  app.post("/fantasy/chip", { preHandler: [requireAuth] }, async (request) => {
    const { user } = getAuthSession(request);
    const { chipType, season } = parseBody(request, chipSchema);
    return await chipActivate(user.id, chipType, season);
  });

  app.post(
    "/fantasy/chip/deactivate",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { chipType, season } = parseBody(request, chipSchema);
      return await chipDeactivate(user.id, chipType, season);
    },
  );

  app.get(
    "/fantasy/team/share",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { season } = parseQuery(request, seasonSchema);
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
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { search } = parseQuery(request, listPlayersSchema);
      return await list(search);
    },
  );

  app.post(
    "/fantasy/admin/toggle-eligibility",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { playCricketId, eligible: isEligible } = parseBody(
        request,
        toggleEligibilitySchema,
      );
      return await toggle(playCricketId, isEligible);
    },
  );

  app.post(
    "/fantasy/admin/populate-players",
    { preHandler: [requireRole("admin")] },
    async () => {
      return await populate();
    },
  );

  app.post(
    "/fantasy/admin/calculate-costs",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { season } = parseBody(request, calculateCostsSchema);
      return await calcCosts(season);
    },
  );

  app.post(
    "/fantasy/admin/calculate-scores",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { season } = parseBody(request, calculateScoresSchema);
      return await calcScores(season ?? getCurrentSeason());
    },
  );

  app.get(
    "/fantasy/admin/chaos-weeks",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { season } = parseQuery(request, seasonSchema);
      return await chaosWeeksList(season);
    },
  );

  app.post(
    "/fantasy/admin/chaos-weeks",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseBody(request, createChaosWeekSchema);
      return await chaosWeekCreate(params);
    },
  );

  app.delete(
    "/fantasy/admin/chaos-weeks",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { id } = parseBody(request, deleteChaosWeekSchema);
      return await chaosWeekDelete(id);
    },
  );
};
