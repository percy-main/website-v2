import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { parseBody, parseQuery } from "../../lib/validation.js";
import { submitScoreSchema, leaderboardQuerySchema } from "./schemas.js";
import { submitScore, getLeaderboard } from "./service.js";

export const leaderboardRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/game-score",
    { preHandler: [requireAuth] },
    async (request) => {
      const { user } = request.authSession!;
      const data = parseBody(request, submitScoreSchema);
      return submitScore(user.id, data);
    },
  );

  app.get("/leaderboard", async (request) => {
    const { game, limit } = parseQuery(request, leaderboardQuerySchema);
    return getLeaderboard(game, limit);
  });
};
