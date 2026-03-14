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

export const juniorRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/junior/dependents",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = request.authSession!;
      const { dependents } = parseBody(request, addDependentsSchema);
      const result = await addDependents(user.email, dependents);
      return result;
    },
  );

  app.get(
    "/junior/dependents",
    { preHandler: [requireVerifiedEmail] },
    async (request) => {
      const { user } = request.authSession!;
      return getDependents(user.email);
    },
  );

  app.get(
    "/junior/teams",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const role =
        (user as { role?: string | null }).role ?? "user";
      return listMyTeams(user.id, role);
    },
  );

  app.get<{ Params: { teamId: string } }>(
    "/junior/teams/:teamId/players",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { teamId } = request.params;
      return listPlayers(user.id, role, teamId);
    },
  );

  app.get<{ Params: { dependentId: string } }>(
    "/junior/players/:dependentId",
    { preHandler: [requireRole("junior_manager", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { dependentId } = request.params;
      return getPlayerDetail(user.id, role, dependentId);
    },
  );
};
