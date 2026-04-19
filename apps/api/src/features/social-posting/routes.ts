import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireRole } from "../auth/middleware.ts";
import {
  matchIdParamSchema,
  reconcileBodySchema,
  reconcileResponseSchema,
  retryBodySchema,
  retryParamsSchema,
  retryResponseSchema,
  socialPublicationsResponseSchema,
} from "./schemas.ts";
import {
  listPublications,
  reconcilePublication,
  retryPublication,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const socialPostingRoutes: FastifyPluginAsyncZod = async (app) => {
  const adminRole = requireRole("admin");

  const list = listPublications(app.db);
  const reconcile = reconcilePublication(app.db);

  app.get(
    "/matchday/:matchId/social-publications",
    {
      preHandler: [adminRole],
      schema: {
        params: matchIdParamSchema,
        response: { 200: socialPublicationsResponseSchema },
      },
    },
    async (request) => {
      return await list(request.params.matchId);
    },
  );

  app.post(
    "/matchday/:matchId/social-publications/:platform/retry",
    {
      preHandler: [adminRole],
      schema: {
        params: retryParamsSchema,
        body: retryBodySchema,
        response: { 200: retryResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";

      return await retryPublication({
        db: app.db,
        llm: app.llm,
        meta: app.meta,
        s3Social: app.s3SocialMedia,
        slackWebhookUrl: app.config.SLACK_WEBHOOK_URL,
        log: request.log,
        enabled: app.config.SOCIAL_POSTING_ENABLED,
      })({
        matchdayId: request.params.matchId,
        platform: request.params.platform,
        userId: user.id,
        role,
        isHome: request.body.isHome,
        matchTime: request.body.matchTime,
      });
    },
  );

  app.post(
    "/matchday/:matchId/social-publications/:platform/reconcile",
    {
      preHandler: [adminRole],
      schema: {
        params: retryParamsSchema,
        body: reconcileBodySchema,
        response: { 200: reconcileResponseSchema },
      },
    },
    async (request) => {
      return await reconcile({
        matchdayId: request.params.matchId,
        platform: request.params.platform,
        ...request.body,
      });
    },
  );
};
