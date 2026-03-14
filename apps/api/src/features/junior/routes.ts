import type { FastifyPluginAsync } from "fastify";
import {
  requireVerifiedEmail,
  requireRole,
  getAuthSession,
} from "../auth/middleware.js";
import { parseBody, parseParams } from "../../lib/validation.js";
import {
  addDependentsSchema,
  teamIdParamSchema,
  dependentIdParamSchema,
} from "./schemas.js";
import {
  addDependents,
  getDependents,
  listMyTeams,
  listPlayers,
  getPlayerDetail,
} from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const juniorRoutes: FastifyPluginAsync = async (app) => {
  const add = addDependents(app.db);
  const get = getDependents(app.db);
  const teams = listMyTeams(app.db);
  const players = listPlayers(app.db);
  const playerDetail = getPlayerDetail(app.db);

  app.post(
    "/junior/dependents",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { dependents } = parseBody(request, addDependentsSchema);
      const result = await add(user.email, dependents);
      return result;
    },
  );

  app.get(
    "/junior/dependents",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = getAuthSession(request);
      return await get(user.email);
    },
  );

  app.get(
    "/junior/teams",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role =
        (user as { role?: string | null }).role ?? "user";
      return await teams(user.id, role);
    },
  );

  app.get(
    "/junior/teams/:teamId/players",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { teamId } = parseParams(request, teamIdParamSchema);
      return await players(user.id, role, teamId);
    },
  );

  app.get(
    "/junior/players/:dependentId",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { dependentId } = parseParams(request, dependentIdParamSchema);
      return await playerDetail(user.id, role, dependentId);
    },
  );
};
