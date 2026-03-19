import type { FastifyPluginAsync } from "fastify";
import { parseParams, parseQuery } from "../../lib/validation.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import { gameDetailParamsSchema, gamesListSchema } from "./schemas.ts";
import { getGame, listGames } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const gamesRoutes: FastifyPluginAsync = async (app) => {
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

  app.get("/games", async (request) => {
    const { season } = parseQuery(request, gamesListSchema);
    const effectiveSeason = season ?? new Date().getFullYear();
    return await list(effectiveSeason);
  });

  app.get("/games/:matchId", async (request) => {
    const { matchId } = parseParams(request, gameDetailParamsSchema);
    const game = await detail(matchId);
    if (!game) {
      const error = new Error("Game not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }
    return game;
  });
};
