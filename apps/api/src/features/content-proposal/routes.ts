import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAuth,
  requirePermission,
} from "../auth/middleware.ts";
import {
  listProposalsResponseSchema,
  profileEditStateResponseSchema,
  proposalDetailResponseSchema,
  proposalIdParamSchema,
  proposalIdResponseSchema,
  rejectProposalSchema,
  submitProposalResponseSchema,
  submitProposalSchema,
} from "./schemas.ts";
import {
  approveProfileProposal,
  getProfileEditState,
  getProposalDetail,
  listPendingProposals,
  rejectProfileProposal,
  submitProfileProposal,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const contentProposalRoutes: FastifyPluginAsyncZod = async (app) => {
  const notifyDeps = {
    baseUrl: app.config.BASE_URL,
    send: app.send,
    log: app.log,
  };

  const editState = getProfileEditState(app.db);
  const submit = submitProfileProposal(app.db, notifyDeps);
  const listPending = listPendingProposals(app.db);
  const detail = getProposalDetail(app.db);
  const approve = approveProfileProposal(app.db, notifyDeps);
  const reject = rejectProfileProposal(app.db, notifyDeps);

  // The reviewer pool is everyone who can publish people. Approving applies
  // the edit to the live profile, so it is gated on the same publish action
  // the manage/publish split reserved for this review tier.
  const reviewProposals = requirePermission("content_people", "publish");

  // ── Owner: self-service ──
  //
  // Any authenticated member can ask for their edit state; eligibility (a
  // slug-linked person profile) is resolved in the service, which returns
  // profile: null for a member with nothing to edit.

  app.get(
    "/profile/edit",
    {
      preHandler: [requireAuth],
      schema: {
        response: { 200: profileEditStateResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await editState(user.email);
    },
  );

  app.post(
    "/profile/edit/proposals",
    {
      preHandler: [requireAuth],
      schema: {
        body: submitProposalSchema,
        response: { 200: submitProposalResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await submit({
        userId: user.id,
        userEmail: user.email,
        body: request.body.body,
        photo: request.body.photo,
      });
    },
  );

  // ── Reviewer: approval queue ──

  app.get(
    "/admin/profile-proposals",
    {
      preHandler: [reviewProposals],
      schema: {
        response: { 200: listProposalsResponseSchema },
      },
    },
    async () => {
      return await listPending();
    },
  );

  app.get(
    "/admin/profile-proposals/:proposalId",
    {
      preHandler: [reviewProposals],
      schema: {
        params: proposalIdParamSchema,
        response: { 200: proposalDetailResponseSchema },
      },
    },
    async (request) => {
      return await detail(request.params.proposalId);
    },
  );

  app.post(
    "/admin/profile-proposals/:proposalId/approve",
    {
      preHandler: [reviewProposals],
      schema: {
        params: proposalIdParamSchema,
        response: { 200: proposalIdResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await approve({
        proposalId: request.params.proposalId,
        reviewerUserId: user.id,
      });
    },
  );

  app.post(
    "/admin/profile-proposals/:proposalId/reject",
    {
      preHandler: [reviewProposals],
      schema: {
        params: proposalIdParamSchema,
        body: rejectProposalSchema,
        response: { 200: proposalIdResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await reject({
        proposalId: request.params.proposalId,
        reviewerUserId: user.id,
        note: request.body?.note,
      });
    },
  );
};
