import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAuth,
  requirePermission,
} from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  assignPlayerResponseSchema,
  assignPlayerSchema,
  assignmentIdParamSchema,
  confirmDateResponseSchema,
  confirmFixtureResponseSchema,
  createRequestResponseSchema,
  createRequestSchema,
  getActiveRequestsResponseSchema,
  getDateDetailResponseSchema,
  getPublicRequestResponseSchema,
  getRequestResponseSchema,
  listRequestsResponseSchema,
  listRequestsSchema,
  notifySendResponseSchema,
  notifySendSchema,
  previewFixturesResponseSchema,
  previewRangeSchema,
  requestDateFixtureParamSchema,
  requestDateMemberParamSchema,
  requestDateParamSchema,
  requestIdParamSchema,
  respondSchema,
  setAvailabilitySchema,
  successResponseSchema,
  updateRequestStatusResponseSchema,
  updateRequestStatusSchema,
} from "./schemas.ts";
import {
  assignPlayer,
  confirmDate,
  confirmFixture,
  createRequest,
  getActiveRequests,
  getDateDetail,
  getPublicRequest,
  getRequest,
  listRequests,
  previewFixtures,
  removeAssignment,
  respond,
  sendAvailabilityNotification,
  setAvailability,
  updateRequestStatus,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const availabilityRoutes: FastifyPluginAsyncZod = async (app) => {
  const matchdayView = requirePermission("matchday", "view");
  const matchdayManage = requirePermission("matchday", "manage");

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
    apiClient && siteId
      ? createRequest(
          app.db,
          apiClient,
          siteId,
          app.send,
          app.sendPush,
          app.config.BASE_URL,
        )
      : null;

  app.post(
    "/availability/requests",
    {
      preHandler: [matchdayManage],
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
      return await create(user.id, request.body, request.log);
    },
  );

  const list = listRequests(app.db);
  app.get(
    "/availability/requests",
    {
      preHandler: [matchdayView],
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
      preHandler: [matchdayView],
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
      preHandler: [matchdayView],
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
      preHandler: [matchdayManage],
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
      preHandler: [matchdayManage],
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
      preHandler: [matchdayManage],
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
      preHandler: [matchdayManage],
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

  const confirmOneFixture = confirmFixture(app.db);
  app.post(
    "/availability/requests/:requestId/dates/:date/fixtures/:fixtureId/confirm",
    {
      preHandler: [matchdayManage],
      schema: {
        params: requestDateFixtureParamSchema,
        response: { 200: confirmFixtureResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await confirmOneFixture(
        user.id,
        request.params.requestId,
        request.params.date,
        request.params.fixtureId,
      );
    },
  );

  const updateStatus = updateRequestStatus(app.db);
  app.patch(
    "/availability/requests/:requestId",
    {
      preHandler: [matchdayManage],
      schema: {
        params: requestIdParamSchema,
        body: updateRequestStatusSchema,
        response: { 200: updateRequestStatusResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await updateStatus(
        user.id,
        request.params.requestId,
        request.body,
      );
    },
  );

  // Preview fixtures for a date range (before creating request)
  const preview =
    apiClient && siteId ? previewFixtures(app.db, apiClient, siteId) : null;

  app.get(
    "/availability/preview",
    {
      preHandler: [matchdayView],
      schema: {
        querystring: previewRangeSchema,
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
  //
  // Notifications fire automatically on create (see /availability/requests
  // POST above). This endpoint exists for re-sends / follow-up nudges.

  const sendNotification = sendAvailabilityNotification(
    app.db,
    app.send,
    app.sendPush,
    app.config.BASE_URL,
  );
  app.post(
    "/availability/requests/:requestId/notify/send",
    {
      preHandler: [matchdayManage],
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
