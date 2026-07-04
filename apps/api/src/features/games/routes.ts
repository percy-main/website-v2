import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  gameDetailParamsSchema,
  gameDetailResponseSchema,
  gamesListResponseSchema,
  gamesListSchema,
  gamesPrerenderManifestResponseSchema,
  wagonWheelResponseSchema,
} from "./schemas.ts";
import {
  getGame,
  getWagonWheel,
  listGames,
  listGamesPrerenderManifest,
} from "./service.ts";

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
  const wagonWheel = getWagonWheel(app.db);
  const prerenderManifest = listGamesPrerenderManifest(app.db, api, siteId);

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

  // Consumed by the prerenderer Lambda on every sync. Public like the
  // content manifest: it reveals only public game URLs, dates and opaque
  // hashes. A Play Cricket outage 500s here BY DESIGN - the Lambda must
  // abort its sync rather than treat an empty list as "all games gone".
  app.get(
    "/games/prerender-manifest",
    {
      schema: {
        response: { 200: gamesPrerenderManifestResponseSchema },
      },
    },
    async () => {
      return await prerenderManifest();
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
      const game = await detail(matchId, request.log);
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

  app.get(
    "/games/:matchId/wagon-wheel",
    {
      schema: {
        params: gameDetailParamsSchema,
        response: { 200: wagonWheelResponseSchema },
      },
    },
    async (request) => {
      return await wagonWheel(request.params.matchId);
    },
  );
};
