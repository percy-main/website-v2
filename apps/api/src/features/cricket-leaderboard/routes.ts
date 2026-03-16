import type { FastifyPluginAsync } from "fastify";
import { parseQuery } from "../../lib/validation.js";
import { cricketLeaderboardQuerySchema } from "./schemas.js";
import { listBattingLeaderboard, listBowlingLeaderboard } from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const cricketLeaderboardRoutes: FastifyPluginAsync = async (app) => {
  const batting = listBattingLeaderboard(app.db);
  const bowling = listBowlingLeaderboard(app.db);

  app.get("/cricket-leaderboard/batting", async (request) => {
    const params = parseQuery(request, cricketLeaderboardQuerySchema);
    return await batting(params);
  });

  app.get("/cricket-leaderboard/bowling", async (request) => {
    const params = parseQuery(request, cricketLeaderboardQuerySchema);
    return await bowling(params);
  });
};
