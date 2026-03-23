import type { FastifyPluginAsync } from "fastify";
import { parseQuery } from "../../lib/validation.ts";
import { recordsQuerySchema } from "./schemas.ts";
import { getHonoursBoard, getRecords } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const recordsRoutes: FastifyPluginAsync = async (app) => {
  const records = getRecords(app.db);
  const honours = getHonoursBoard(app.db);

  app.get("/records", async (request) => {
    const params = parseQuery(request, recordsQuerySchema);
    return await records(params);
  });

  app.get("/records/honours", async (request) => {
    const params = parseQuery(request, recordsQuerySchema);
    return await honours(params);
  });
};
