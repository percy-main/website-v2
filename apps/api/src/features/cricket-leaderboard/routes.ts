import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  battingLeaderboardResponseSchema,
  bowlingLeaderboardResponseSchema,
  cricketLeaderboardQuerySchema,
} from "./schemas.ts";
import { listBattingLeaderboard, listBowlingLeaderboard } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const cricketLeaderboardRoutes: FastifyPluginAsyncZod = async (app) => {
  const batting = listBattingLeaderboard(app.db);
  const bowling = listBowlingLeaderboard(app.db);

  app.get(
    "/cricket-leaderboard/batting",
    {
      schema: {
        querystring: cricketLeaderboardQuerySchema,
        response: { 200: battingLeaderboardResponseSchema },
      },
    },
    async (request) => {
      return await batting(request.query);
    },
  );

  app.get(
    "/cricket-leaderboard/bowling",
    {
      schema: {
        querystring: cricketLeaderboardQuerySchema,
        response: { 200: bowlingLeaderboardResponseSchema },
      },
    },
    async (request) => {
      return await bowling(request.query);
    },
  );
};
