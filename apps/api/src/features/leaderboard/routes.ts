import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseQuery } from "../../lib/validation.ts";
import { getAuthSession, requireAuth } from "../auth/middleware.ts";
import { leaderboardQuerySchema, submitScoreSchema } from "./schemas.ts";
import { getLeaderboard, submitScore } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const leaderboardRoutes: FastifyPluginAsync = async (app) => {
  const submit = submitScore(app.db);
  const leaderboard = getLeaderboard(app.db);

  app.post("/game-score", { preHandler: [requireAuth] }, async (request) => {
    const { user } = getAuthSession(request);
    const data = parseBody(request, submitScoreSchema);
    return await submit(user.id, data);
  });

  app.get("/leaderboard", async (request) => {
    const { game, limit } = parseQuery(request, leaderboardQuerySchema);
    return await leaderboard(game, limit);
  });
};
