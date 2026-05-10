import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAuth,
  requireRole,
} from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  assignPlayerResponseSchema,
  assignPlayerSchema,
  assignmentIdParamSchema,
  confirmDateResponseSchema,
  createRequestResponseSchema,
  createRequestSchema,
  getActiveRequestsResponseSchema,
  getDateDetailResponseSchema,
  getPublicRequestResponseSchema,
  getRequestResponseSchema,
  listRequestsResponseSchema,
  listRequestsSchema,
  notifyPreviewResponseSchema,
  notifyPreviewSchema,
  notifySendResponseSchema,
  notifySendSchema,
  previewFixturesResponseSchema,
  requestDateMemberParamSchema,
  requestDateParamSchema,
  requestIdParamSchema,
  respondSchema,
  setAvailabilitySchema,
  successResponseSchema,
  updateRequestStatusSchema,
} from "./schemas.ts";
import {
  assignPlayer,
  confirmDate,
  createRequest,
  getActiveRequests,
  getDateDetail,
  getPublicRequest,
  getRequest,
  listRequests,
  previewFixtures,
  previewNotifyRecipients,
  removeAssignment,
  respond,
  sendAvailabilityNotification,
  setAvailability,
  updateRequestStatus,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const availabilityRoutes: FastifyPluginAsyncZod = async (app) => {
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
    {
      preHandler: [officialRole],
      schema: {
        body: createRequestSchema,
        response: { 200: createRequestResponseSchema },
      },
    },
    async (request) => {
      if (!create) {
        throw Object.assign(new Error("Play Cricket API not configured"), {
          statusCode: 503,
        });
      }
      const { user } = getAuthSession(request);
      return await create(user.id, request.body);
    },
  );

  const list = listRequests(app.db);
  app.get(
    "/availability/requests",
    {
      preHandler: [officialRole],
      schema: {
        querystring: listRequestsSchema,
        response: { 200: listRequestsResponseSchema },
      },
    },
    async (request) => {
      return await list(request.query);
    },
  );

  const get = getRequest(app.db);
  app.get(
    "/availability/requests/:requestId",
    {
      preHandler: [officialRole],
      schema: {
        params: requestIdParamSchema,
        response: { 200: getRequestResponseSchema },
      },
    },
    async (request) => {
      return await get(request.params.requestId);
    },
  );

  const getDate = getDateDetail(app.db);
  app.get(
    "/availability/requests/:requestId/dates/:date",
    {
      preHandler: [officialRole],
      schema: {
        params: requestDateParamSchema,
        response: { 200: getDateDetailResponseSchema },
      },
    },
    async (request) => {
      return await getDate(request.params.requestId, request.params.date);
    },
  );

  const assign = assignPlayer(app.db);
  app.post(
    "/availability/requests/:requestId/dates/:date/assign",
    {
      preHandler: [officialRole],
      schema: {
        params: requestDateParamSchema,
        body: assignPlayerSchema,
        response: { 200: assignPlayerResponseSchema },
      },
    },
    async (request) => {
      return await assign(
        request.params.requestId,
        request.params.date,
        request.body,
      );
    },
  );

  const removeAssign = removeAssignment(app.db);
  app.delete(
    "/availability/assignments/:assignmentId",
    {
      preHandler: [officialRole],
      schema: {
        params: assignmentIdParamSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      return await removeAssign(request.params.assignmentId);
    },
  );

  const setAvail = setAvailability(app.db);
  app.put(
    "/availability/requests/:requestId/dates/:date/members/:memberId/availability",
    {
      preHandler: [officialRole],
      schema: {
        params: requestDateMemberParamSchema,
        body: setAvailabilitySchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await setAvail(
        user.id,
        request.params.requestId,
        request.params.date,
        request.params.memberId,
        request.body,
      );
    },
  );

  const confirm = confirmDate(app.db);
  app.post(
    "/availability/requests/:requestId/dates/:date/confirm",
    {
      preHandler: [officialRole],
      schema: {
        params: requestDateParamSchema,
        response: { 200: confirmDateResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await confirm(
        user.id,
        request.params.requestId,
        request.params.date,
      );
    },
  );

  const updateStatus = updateRequestStatus(app.db);
  app.patch(
    "/availability/requests/:requestId",
    {
      preHandler: [officialRole],
      schema: {
        params: requestIdParamSchema,
        body: updateRequestStatusSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      return await updateStatus(request.params.requestId, request.body);
    },
  );

  // Preview fixtures for a date range (before creating request)
  const preview =
    apiClient && siteId ? previewFixtures(app.db, apiClient, siteId) : null;

  app.get(
    "/availability/preview",
    {
      preHandler: [officialRole],
      schema: {
        querystring: createRequestSchema,
        response: { 200: previewFixturesResponseSchema },
      },
    },
    async (request) => {
      if (!preview) {
        throw Object.assign(new Error("Play Cricket API not configured"), {
          statusCode: 503,
        });
      }
      return await preview(request.query.dateFrom, request.query.dateTo);
    },
  );

  // ── Notification Routes ──

  const previewRecipients = previewNotifyRecipients(app.db);
  app.post(
    "/availability/requests/:requestId/notify/preview",
    {
      preHandler: [officialRole],
      schema: {
        params: requestIdParamSchema,
        body: notifyPreviewSchema,
        response: { 200: notifyPreviewResponseSchema },
      },
    },
    async (request) => {
      return await previewRecipients(request.params.requestId, request.body);
    },
  );

  const sendNotification = sendAvailabilityNotification(
    app.db,
    app.send,
    app.config.BASE_URL,
  );
  app.post(
    "/availability/requests/:requestId/notify/send",
    {
      preHandler: [officialRole],
      schema: {
        params: requestIdParamSchema,
        body: notifySendSchema,
        response: { 200: notifySendResponseSchema },
      },
    },
    async (request) => {
      return await sendNotification(
        request.params.requestId,
        request.body,
        request.log,
      );
    },
  );

  // ── Public Routes ──

  const getPublic = getPublicRequest(app.db);
  app.get(
    "/availability/requests/:requestId/public",
    {
      schema: {
        params: requestIdParamSchema,
        response: { 200: getPublicRequestResponseSchema },
      },
    },
    async (request) => {
      return await getPublic(request.params.requestId);
    },
  );

  // ── Member Routes ──

  const getActive = getActiveRequests(app.db);
  app.get(
    "/availability/active",
    {
      preHandler: [requireAuth],
      schema: {
        response: { 200: getActiveRequestsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await getActive(user.email);
    },
  );

  const submitResponse = respond(app.db);
  app.post(
    "/availability/requests/:requestId/respond",
    {
      preHandler: [requireAuth],
      schema: {
        params: requestIdParamSchema,
        body: respondSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await submitResponse(
        user.email,
        request.params.requestId,
        request.body,
      );
    },
  );
};
