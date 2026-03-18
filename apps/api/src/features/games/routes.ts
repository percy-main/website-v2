import type { FastifyPluginAsync } from "fastify";
import { parseParams, parseQuery } from "../../lib/validation.js";
import { createApiClient } from "../play-cricket/api-client.js";
import { gameDetailParamsSchema, gamesListSchema } from "./schemas.js";
import { getGame, listGames } from "./service.js";

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
