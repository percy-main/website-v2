import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { parseBody, parseQuery } from "../../lib/validation.js";
import {
  seasonSchema,
  saveTeamSchema,
  listPlayersSchema,
  toggleEligibilitySchema,
  calculateCostsSchema,
} from "./schemas.js";
import {
  getEligiblePlayers,
  getMyTeam,
  saveTeam,
  listPlayers,
  toggleEligibility,
  populatePlayers,
  calculateSandwichCosts,
} from "./service.js";

export const fantasyRoutes: FastifyPluginAsync = async (app) => {
  // --- Player-facing routes ---

  app.get(
    "/fantasy/players",
    { preHandler: [requireAuth] },
    async (request) => {
      const { season } = parseQuery(request, seasonSchema);
      return getEligiblePlayers(season);
    },
  );

  app.get(
    "/fantasy/team",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const { season } = parseQuery(request, seasonSchema);
      return getMyTeam(user.id, season);
    },
  );

  app.post(
    "/fantasy/team",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const { season, players } = parseBody(request, saveTeamSchema);
      return saveTeam(user.id, players, season);
    },
  );

  // --- Admin routes ---

  app.get(
    "/fantasy/admin/players",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { search } = parseQuery(request, listPlayersSchema);
      return listPlayers(search);
    },
  );

  app.post(
    "/fantasy/admin/toggle-eligibility",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { playCricketId, eligible } = parseBody(
        request,
        toggleEligibilitySchema,
      );
      return toggleEligibility(playCricketId, eligible);
    },
  );

  app.post(
    "/fantasy/admin/populate-players",
    { preHandler: [requireRole("admin")] },
    async () => {
      return populatePlayers();
    },
  );

  app.post(
    "/fantasy/admin/calculate-costs",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { season } = parseBody(request, calculateCostsSchema);
      return calculateSandwichCosts(season);
    },
  );
};
