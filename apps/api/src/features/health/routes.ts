import type { FastifyPluginAsync } from "fastify";
import { client } from "@percy-main/db";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    try {
      await client.selectFrom("user").select("id").limit(1).execute();
      return { status: "ok", database: "connected" };
    } catch {
      return { status: "degraded", database: "disconnected" };
    }
  });
};
