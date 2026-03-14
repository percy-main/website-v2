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
  const eligible = getEligiblePlayers(app.db);
  const myTeam = getMyTeam(app.db);
  const save = saveTeam(app.db);
  const list = listPlayers(app.db);
  const toggle = toggleEligibility(app.db);
  const populate = populatePlayers(app.db);
  const calcCosts = calculateSandwichCosts(app.db);

  // --- Player-facing routes ---

  app.get(
    "/fantasy/players",
    { preHandler: [requireAuth] },
    async (request) => {
      const { season } = parseQuery(request, seasonSchema);
      return eligible(season);
    },
  );

  app.get(
    "/fantasy/team",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const { season } = parseQuery(request, seasonSchema);
      return myTeam(user.id, season);
    },
  );

  app.post(
    "/fantasy/team",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const { season, players } = parseBody(request, saveTeamSchema);
      return save(user.id, players, season);
    },
  );

  // --- Admin routes ---

  app.get(
    "/fantasy/admin/players",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { search } = parseQuery(request, listPlayersSchema);
      return list(search);
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
      return toggle(playCricketId, isEligible);
    },
  );

  app.post(
    "/fantasy/admin/populate-players",
    { preHandler: [requireRole("admin")] },
    async () => {
      return populate();
    },
  );

  app.post(
    "/fantasy/admin/calculate-costs",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { season } = parseBody(request, calculateCostsSchema);
      return calcCosts(season);
    },
  );
};
