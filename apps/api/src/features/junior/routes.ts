import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireRole,
  requireVerifiedEmail,
} from "../auth/middleware.ts";
import {
  addDependentsResponseSchema,
  addDependentsSchema,
  dependentIdParamSchema,
  getDependentsResponseSchema,
  playerDetailResponseSchema,
  playersResponseSchema,
  teamIdParamSchema,
  teamResponseSchema,
} from "./schemas.ts";
import {
  addDependents,
  getDependents,
  getPlayerDetail,
  listMyTeams,
  listPlayers,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const juniorRoutes: FastifyPluginAsyncZod = async (app) => {
  const add = addDependents(app.db);
  const get = getDependents(app.db);
  const teams = listMyTeams(app.db);
  const players = listPlayers(app.db);
  const playerDetail = getPlayerDetail(app.db);

  app.post(
    "/junior/dependents",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        body: addDependentsSchema,
        response: { 200: addDependentsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { dependents } = request.body;
      const result = await add(user.email, dependents);
      return result;
    },
  );

  app.get(
    "/junior/dependents",
    {
      preHandler: [requireVerifiedEmail],
      schema: {
        response: { 200: getDependentsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await get(user.email);
    },
  );

  app.get(
    "/junior/teams",
    {
      preHandler: [requireRole("junior_manager", "admin")],
      schema: {
        response: { 200: teamResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await teams(user.id, role);
    },
  );

  app.get(
    "/junior/teams/:teamId/players",
    {
      preHandler: [requireRole("junior_manager", "admin")],
      schema: {
        params: teamIdParamSchema,
        response: { 200: playersResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { teamId } = request.params;
      return await players(user.id, role, teamId);
    },
  );

  app.get(
    "/junior/players/:dependentId",
    {
      preHandler: [requireRole("junior_manager", "admin")],
      schema: {
        params: dependentIdParamSchema,
        response: { 200: playerDetailResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dependentId } = request.params;
      return await playerDetail(user.id, role, dependentId);
    },
  );
};
