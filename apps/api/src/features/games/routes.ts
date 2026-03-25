import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  gameDetailParamsSchema,
  gameDetailResponseSchema,
  gamesListResponseSchema,
  gamesListSchema,
} from "./schemas.ts";
import { getGame, listGames } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const gamesRoutes: FastifyPluginAsyncZod = async (app) => {
  const config = app.config;

  if (!config.PLAY_CRICKET_API_TOKEN || !config.PLAY_CRICKET_SITE_ID) {
    app.log.warn(
      "Play Cricket credentials not configured — games routes disabled",
    );
    return;
  }

  const api = createApiClient({
    apiToken: config.PLAY_CRICKET_API_TOKEN,
    siteId: config.PLAY_CRICKET_SITE_ID,
  });

  const siteId = config.PLAY_CRICKET_SITE_ID;

  const list = listGames(app.db, api, siteId);
  const detail = getGame(app.db, api, siteId);

  app.get(
    "/games",
    {
      schema: {
        querystring: gamesListSchema,
        response: { 200: gamesListResponseSchema },
      },
    },
    async (request) => {
      const { season } = request.query;
      const effectiveSeason = season ?? new Date().getFullYear();
      return await list(effectiveSeason);
    },
  );

  app.get(
    "/games/:matchId",
    {
      schema: {
        params: gameDetailParamsSchema,
        response: { 200: gameDetailResponseSchema },
      },
    },
    async (request) => {
      const { matchId } = request.params;
      const game = await detail(matchId);
      if (!game) {
        const error = new Error("Game not found") as Error & {
          statusCode: number;
        };
        error.statusCode = 404;
        throw error;
      }
      return game;
    },
  );
};
