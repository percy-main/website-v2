import type { FastifyPluginAsync } from "fastify";
import { parseParams } from "../../lib/validation.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import { ogImageParamsSchema } from "./schemas.ts";
import { buildOgHtmlPage, generateOgImage } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const ogImageRoutes: FastifyPluginAsync = async (app) => {
  const config = app.config;

  if (!config.PLAY_CRICKET_API_TOKEN || !config.PLAY_CRICKET_SITE_ID) {
    app.log.warn(
      "Play Cricket credentials not configured — OG image routes disabled",
    );
    return;
  }

  const api = createApiClient({
    apiToken: config.PLAY_CRICKET_API_TOKEN,
    siteId: config.PLAY_CRICKET_SITE_ID,
  });

  const siteId = config.PLAY_CRICKET_SITE_ID;
  const generate = generateOgImage(app.db, api, siteId);

  // OG image endpoint — returns PNG
  app.get("/og/game/:matchId", async (request, reply) => {
    const { matchId } = parseParams(request, ogImageParamsSchema);
    const image = await generate(matchId, request.log);

    if (!image) {
      const error = new Error("Match not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    return await reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=3600")
      .send(image);
  });

  // OG HTML page — serves meta tags for crawlers, redirects humans to SPA
  app.get("/og/game/:matchId/page", async (request, reply) => {
    const { matchId } = parseParams(request, ogImageParamsSchema);

    const hasResult = await app.db
      .selectFrom("match_result")
      .where("match_id", "=", matchId)
      .select("match_id")
      .executeTakeFirst();

    const label = hasResult ? "Match Result" : "Fixture Details";
    const title = `${label} — Percy Main Cricket & Sports Club`;

    const html = buildOgHtmlPage(
      config.BASE_URL,
      config.API_BASE_URL,
      matchId,
      title,
    );

    return await reply.header("Content-Type", "text/html").send(html);
  });
};
