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
  assignmentIdParamSchema,
  createRequestSchema,
  listRequestsSchema,
  overrideResponseSchema,
  requestDateParamSchema,
  requestIdParamSchema,
  respondSchema,
  responseIdParamSchema,
  updateRequestStatusSchema,
} from "./schemas.ts";
import {
  assignPlayer,
  confirmDate,
  createRequest,
  getActiveRequests,
  getDateDetail,
  getRequest,
  listRequests,
  overrideResponse,
  previewFixtures,
  removeAssignment,
  respond,
  updateRequestStatus,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const availabilityRoutes: FastifyPluginAsync = async (app) => {
  const officialRole = requireRole("official", "admin");

  // Build Play Cricket API client (if configured)
  const apiClient =
    app.config.PLAY_CRICKET_API_TOKEN && app.config.PLAY_CRICKET_SITE_ID
      ? createApiClient({
          apiToken: app.config.PLAY_CRICKET_API_TOKEN,
          siteId: app.config.PLAY_CRICKET_SITE_ID,
        })
      : null;

  const siteId = app.config.PLAY_CRICKET_SITE_ID ?? "";

  // ── Official Routes ──

  const create =
    apiClient && siteId ? createRequest(app.db, apiClient, siteId) : null;

  app.post(
    "/availability/requests",
    { preHandler: [officialRole] },
    async (request) => {
      if (!create) {
        throw Object.assign(new Error("Play Cricket API not configured"), {
          statusCode: 503,
        });
      }
      const { user } = getAuthSession(request);
      const data = parseBody(request, createRequestSchema);
      return await create(user.id, data);
    },
  );

  const list = listRequests(app.db);
  app.get(
    "/availability/requests",
    { preHandler: [officialRole] },
    async (request) => {
      const params = parseQuery(request, listRequestsSchema);
      return await list(params);
    },
  );

  const get = getRequest(app.db);
  app.get(
    "/availability/requests/:requestId",
    { preHandler: [officialRole] },
    async (request) => {
      const { requestId } = parseParams(request, requestIdParamSchema);
      return await get(requestId);
    },
  );

  const getDate = getDateDetail(app.db);
  app.get(
    "/availability/requests/:requestId/dates/:date",
    { preHandler: [officialRole] },
    async (request) => {
      const { requestId, date } = parseParams(request, requestDateParamSchema);
      return await getDate(requestId, date);
    },
  );

  const assign = assignPlayer(app.db);
  app.post(
    "/availability/requests/:requestId/dates/:date/assign",
    { preHandler: [officialRole] },
    async (request) => {
      const { requestId, date } = parseParams(request, requestDateParamSchema);
      const data = parseBody(request, assignPlayerSchema);
      return await assign(requestId, date, data);
    },
  );

  const removeAssign = removeAssignment(app.db);
  app.delete(
    "/availability/assignments/:assignmentId",
    { preHandler: [officialRole] },
    async (request) => {
      const { assignmentId } = parseParams(request, assignmentIdParamSchema);
      return await removeAssign(assignmentId);
    },
  );

  const override = overrideResponse(app.db);
  app.put(
    "/availability/responses/:responseId/override",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { responseId } = parseParams(request, responseIdParamSchema);
      const data = parseBody(request, overrideResponseSchema);
      return await override(user.id, responseId, data);
    },
  );

  const confirm = confirmDate(app.db);
  app.post(
    "/availability/requests/:requestId/dates/:date/confirm",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { requestId, date } = parseParams(request, requestDateParamSchema);
      return await confirm(user.id, requestId, date);
    },
  );

  const updateStatus = updateRequestStatus(app.db);
  app.patch(
    "/availability/requests/:requestId",
    { preHandler: [officialRole] },
    async (request) => {
      const { requestId } = parseParams(request, requestIdParamSchema);
      const data = parseBody(request, updateRequestStatusSchema);
      return await updateStatus(requestId, data);
    },
  );

  // Preview fixtures for a date range (before creating request)
  const preview =
    apiClient && siteId ? previewFixtures(app.db, apiClient, siteId) : null;

  app.get(
    "/availability/preview",
    { preHandler: [officialRole] },
    async (request) => {
      if (!preview) {
        throw Object.assign(new Error("Play Cricket API not configured"), {
          statusCode: 503,
        });
      }
      const params = parseQuery(request, createRequestSchema);
      return await preview(params.dateFrom, params.dateTo);
    },
  );

  // ── Member Routes ──

  const getActive = getActiveRequests(app.db);
  app.get(
    "/availability/active",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      return await getActive(user.email);
    },
  );

  const submitResponse = respond(app.db);
  app.post(
    "/availability/requests/:requestId/respond",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { requestId } = parseParams(request, requestIdParamSchema);
      const data = parseBody(request, respondSchema);
      return await submitResponse(user.email, requestId, data);
    },
  );
};
