import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.ts";
import {
  getAuthSession,
  requireAuth,
  requireRole,
} from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  assignPlayerSchema,
  createRequestSchema,
  dateIdParamSchema,
  declareAvailabilitySchema,
  gridQuerySchema,
  previewQuerySchema,
  requestIdParamSchema,
  setAvailabilityForMemberSchema,
  unassignPlayerSchema,
} from "./schemas.ts";
import {
  assignPlayer,
  createRequest,
  declareAvailability,
  deleteRequest,
  getAvailabilityGrid,
  getMyAvailability,
  getRequest,
  listRequests,
  previewGamesInWindow,
  setAvailabilityForMember,
  unassignPlayer,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const availabilityRoutes: FastifyPluginAsync = async (app) => {
  const officialRole = requireRole("official", "admin");

  // Play Cricket API client — wired at registration time (same pattern as matchday)
  const playCricketApi =
    app.config.PLAY_CRICKET_API_TOKEN && app.config.PLAY_CRICKET_SITE_ID
      ? createApiClient({
          apiToken: app.config.PLAY_CRICKET_API_TOKEN,
          siteId: app.config.PLAY_CRICKET_SITE_ID,
        })
      : null;
  const siteId = app.config.PLAY_CRICKET_SITE_ID ?? "";

  // ── Request CRUD (official) ──

  const create = createRequest(app.db, playCricketApi, siteId);
  const list = listRequests(app.db);
  const get = getRequest(app.db, playCricketApi, siteId);
  const remove = deleteRequest(app.db);
  const preview = previewGamesInWindow(app.db, playCricketApi, siteId);

  app.post(
    "/availability/requests",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const data = parseBody(request, createRequestSchema);
      return await create(user.id, role, data);
    },
  );

  app.get(
    "/availability/requests",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await list(user.id, role);
    },
  );

  app.get(
    "/availability/requests/:requestId",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { requestId } = parseParams(request, requestIdParamSchema);
      return await get(user.id, role, requestId);
    },
  );

  app.delete(
    "/availability/requests/:requestId",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { requestId } = parseParams(request, requestIdParamSchema);
      return await remove(user.id, role, requestId);
    },
  );

  app.get(
    "/availability/preview",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { startDate, endDate } = parseQuery(request, previewQuerySchema);
      return await preview(user.id, role, startDate, endDate);
    },
  );

  // ── Grid & assignment routes (official) ──

  const getGrid = getAvailabilityGrid(app.db);
  const setForMember = setAvailabilityForMember(app.db);
  const assign = assignPlayer(app.db);
  const unassign = unassignPlayer(app.db);

  app.get(
    "/availability/requests/:requestId/grid",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { requestId } = parseParams(request, requestIdParamSchema);
      const { matchDate } = parseQuery(request, gridQuerySchema);
      return await getGrid(user.id, role, requestId, matchDate);
    },
  );

  app.post(
    "/availability/dates/:dateId/set",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, setAvailabilityForMemberSchema);
      return await setForMember(user.id, role, dateId, data);
    },
  );

  app.post(
    "/availability/dates/:dateId/assign",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, assignPlayerSchema);
      return await assign(user.id, role, dateId, data);
    },
  );

  app.delete(
    "/availability/dates/:dateId/assignments",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, unassignPlayerSchema);
      return await unassign(user.id, role, dateId, data);
    },
  );

  // ── Member routes ──

  const myAvailability = getMyAvailability(app.db);
  const declare = declareAvailability(app.db);

  app.get(
    "/availability/me",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      return await myAvailability(user.id);
    },
  );

  app.post(
    "/availability/dates/:dateId/declare",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { dateId } = parseParams(request, dateIdParamSchema);
      const data = parseBody(request, declareAvailabilitySchema);
      return await declare(user.id, dateId, data);
    },
  );
};
