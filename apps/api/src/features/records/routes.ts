import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  honoursResponseSchema,
  recordsQuerySchema,
  recordsResponseSchema,
} from "./schemas.ts";
import { getHonoursBoard, getRecords } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const recordsRoutes: FastifyPluginAsyncZod = async (app) => {
  const records = getRecords(app.db);
  const honours = getHonoursBoard(app.db);

  app.get(
    "/records",
    {
      schema: {
        querystring: recordsQuerySchema,
        response: { 200: recordsResponseSchema },
      },
    },
    async (request) => {
      return await records(request.query);
    },
  );

  app.get(
    "/records/honours",
    {
      schema: {
        querystring: recordsQuerySchema,
        response: { 200: honoursResponseSchema },
      },
    },
    async (request) => {
      return await honours(request.query);
    },
  );
};
