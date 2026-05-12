import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireRole } from "../auth/middleware.ts";
import { createStripe } from "../payments/stripe.ts";
import {
  applyMembershipReliefResponseSchema,
  applyMembershipReliefSchema,
  closeGrantResponseSchema,
  closeGrantSchema,
  decideReliefRequestResponseSchema,
  decideReliefRequestSchema,
  declineRequestResponseSchema,
  declineRequestSchema,
  eligibleMembersResponseSchema,
  grantIdParamSchema,
  listReliefRequestsResponseSchema,
  listReliefRequestsSchema,
  myReliefStatusResponseSchema,
  reliefReportResponseSchema,
  reliefReportSchema,
  reliefRequestDetailResponseSchema,
  requestIdParamSchema,
  submitReliefRequestResponseSchema,
  submitReliefRequestSchema,
  transitionStatusResponseSchema,
  transitionStatusSchema,
  withdrawRequestResponseSchema,
  withdrawRequestSchema,
} from "./schemas.ts";
import {
  applyMembershipRelief,
  closeReliefGrant,
  decideReliefRequest,
  declineReliefRequest,
  getEligibleMembers,
  getMyReliefStatus,
  getReliefReport,
  getReliefRequestDetail,
  listReliefRequestsForAdmin,
  submitReliefRequest,
  transitionReliefRequestStatus,
  withdrawReliefRequest,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const financialReliefRoutes: FastifyPluginAsyncZod = async (app) => {
  const stripe = createStripe({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
  });
  const eligible = getEligibleMembers(app.db);
  const submit = submitReliefRequest(app.db, {
    baseUrl: app.config.BASE_URL,
    send: app.send,
  });
  const myStatus = getMyReliefStatus(app.db);
  const withdraw = withdrawReliefRequest(app.db);
  const listAdmin = listReliefRequestsForAdmin(app.db);
  const getDetail = getReliefRequestDetail(app.db);
  const transition = transitionReliefRequestStatus(app.db);
  const decline = declineReliefRequest(app.db);
  const decide = decideReliefRequest(app.db, {
    stripe,
    baseUrl: app.config.BASE_URL,
    send: app.send,
  });
  const closeGrant = closeReliefGrant(app.db);
  const applyMembership = applyMembershipRelief(app.db);
  const report = getReliefReport(app.db);

  // --- Member-facing ---

  app.get(
    "/financial-relief/eligible-members",
    {
      schema: { response: { 200: eligibleMembersResponseSchema } },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await eligible(session.user.email);
    },
  );

  app.get(
    "/financial-relief/me",
    {
      schema: { response: { 200: myReliefStatusResponseSchema } },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await myStatus(session.user.email);
    },
  );

  app.post(
    "/financial-relief/requests",
    {
      schema: {
        body: submitReliefRequestSchema,
        response: { 200: submitReliefRequestResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await submit(
        session.user.id,
        session.user.email,
        request.body,
        request.log,
      );
    },
  );

  app.post(
    "/financial-relief/requests/:requestId/withdraw",
    {
      schema: {
        params: requestIdParamSchema,
        body: withdrawRequestSchema,
        response: { 200: withdrawRequestResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await withdraw(
        session.user.id,
        session.user.email,
        request.params.requestId,
        request.body,
      );
    },
  );

  // --- Admin ---

  app.get(
    "/admin/financial-relief/requests",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listReliefRequestsSchema,
        response: { 200: listReliefRequestsResponseSchema },
      },
    },
    async (request) => {
      return await listAdmin(request.query);
    },
  );

  app.get(
    "/admin/financial-relief/requests/:requestId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: requestIdParamSchema,
        response: { 200: reliefRequestDetailResponseSchema },
      },
    },
    async (request) => {
      return await getDetail(request.params.requestId);
    },
  );

  app.post(
    "/admin/financial-relief/requests/:requestId/status",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: requestIdParamSchema,
        body: transitionStatusSchema,
        response: { 200: transitionStatusResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await transition(
        session.user.id,
        request.params.requestId,
        request.body,
      );
    },
  );

  app.post(
    "/admin/financial-relief/requests/:requestId/decline",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: requestIdParamSchema,
        body: declineRequestSchema,
        response: { 200: declineRequestResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await decline(
        session.user.id,
        request.params.requestId,
        request.body,
      );
    },
  );

  app.post(
    "/admin/financial-relief/requests/:requestId/decide",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: requestIdParamSchema,
        body: decideReliefRequestSchema,
        response: { 200: decideReliefRequestResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await decide(
        session.user.id,
        request.params.requestId,
        request.body,
        request.log,
      );
    },
  );

  app.post(
    "/admin/financial-relief/grants/:grantId/close",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: grantIdParamSchema,
        body: closeGrantSchema,
        response: { 200: closeGrantResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await closeGrant(
        session.user.id,
        request.params.grantId,
        request.body,
      );
    },
  );

  app.post(
    "/admin/financial-relief/grants/:grantId/apply-membership",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: grantIdParamSchema,
        body: applyMembershipReliefSchema,
        response: { 200: applyMembershipReliefResponseSchema },
      },
    },
    async () => {
      return await applyMembership();
    },
  );

  app.get(
    "/admin/financial-relief/report",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: reliefReportSchema,
        response: { 200: reliefReportResponseSchema },
      },
    },
    async () => {
      return await report();
    },
  );
};
