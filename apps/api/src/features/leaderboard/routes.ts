import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireAuth } from "../auth/middleware.ts";
import {
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  submitScoreResponseSchema,
  submitScoreSchema,
} from "./schemas.ts";
import { getLeaderboard, submitScore } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const leaderboardRoutes: FastifyPluginAsyncZod = async (app) => {
  const submit = submitScore(app.db);
  const leaderboard = getLeaderboard(app.db);

  app.post(
    "/game-score",
    {
      preHandler: [requireAuth],
      schema: {
        body: submitScoreSchema,
        response: { 200: submitScoreResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await submit(user.id, request.body);
    },
  );

  app.get(
    "/leaderboard",
    {
      schema: {
        querystring: leaderboardQuerySchema,
        response: { 200: leaderboardResponseSchema },
      },
    },
    async (request) => {
      const { game, limit } = request.query;
      return await leaderboard(game, limit);
    },
  );
};
