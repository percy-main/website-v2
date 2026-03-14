import type { FastifyPluginAsync } from "fastify";
import {
  requireVerifiedEmail,
  requireRole,
} from "../auth/middleware.js";
import { parseBody } from "../../lib/validation.js";
import { addDependentsSchema } from "./schemas.js";
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
      if (!request.authSession) throw new Error("Unauthorized");
      const { user } = request.authSession;
      const { dependents } = parseBody(request, addDependentsSchema);
      const result = await add(user.email, dependents);
      return result;
    },
  );

  app.get(
    "/junior/dependents",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      if (!request.authSession) throw new Error("Unauthorized");
      const { user } = request.authSession;
      return await get(user.email);
    },
  );

  app.get(
    "/junior/teams",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      if (!request.authSession) throw new Error("Unauthorized");
      const { user } = request.authSession;
      const role =
        (user as { role?: string | null }).role ?? "user";
      return await teams(user.id, role);
    },
  );

  app.get<{ Params: { teamId: string } }>(
    "/junior/teams/:teamId/players",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      if (!request.authSession) throw new Error("Unauthorized");
      const { user } = request.authSession;
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { teamId } = request.params;
      return await players(user.id, role, teamId);
    },
  );

  app.get<{ Params: { dependentId: string } }>(
    "/junior/players/:dependentId",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      if (!request.authSession) throw new Error("Unauthorized");
      const { user } = request.authSession;
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { dependentId } = request.params;
      return await playerDetail(user.id, role, dependentId);
    },
  );
};
