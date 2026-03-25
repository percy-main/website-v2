import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { healthResponseSchema } from "./schemas.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async () => {
      try {
        await app.db.selectFrom("user").select("id").limit(1).execute();
        return { status: "ok" as const, database: "connected" as const };
      } catch {
        return {
          status: "degraded" as const,
          database: "disconnected" as const,
        };
      }
    },
  );
};
