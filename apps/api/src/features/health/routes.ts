import type { FastifyPluginAsync } from "fastify";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    try {
      await app.db.selectFrom("user").select("id").limit(1).execute();
      return { status: "ok", database: "connected" };
    } catch {
      return { status: "degraded", database: "disconnected" };
    }
  });
};
