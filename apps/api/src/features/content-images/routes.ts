import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireAnyPermission } from "../auth/middleware.ts";
import {
  confirmUploadSchema,
  contentImageResponseSchema,
  uploadUrlResponseSchema,
  uploadUrlSchema,
} from "./schemas.ts";
import { confirmUpload, createUploadUrl } from "./service.ts";

// Any content editor can upload images - the image library is shared
// across content kinds, so the gate is "may manage any content".
const requireAnyContentManage = requireAnyPermission(
  { resource: "content", action: "manage" },
  { resource: "content_news", action: "manage" },
  { resource: "content_reports", action: "manage" },
  { resource: "content_people", action: "manage" },
);

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const contentImageRoutes: FastifyPluginAsyncZod = async (app) => {
  const uploadUrl = createUploadUrl(app.contentImages, app.config);
  const confirm = confirmUpload(app.db, app.contentImages, app.config);

  app.post(
    "/admin/content-images/upload-url",
    {
      preHandler: [requireAnyContentManage],
      schema: {
        body: uploadUrlSchema,
        response: { 200: uploadUrlResponseSchema },
      },
    },
    async (request) => {
      return await uploadUrl({ contentType: request.body.contentType });
    },
  );

  app.post(
    "/admin/content-images",
    {
      preHandler: [requireAnyContentManage],
      schema: {
        body: confirmUploadSchema,
        response: { 200: contentImageResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await confirm({
        imageId: request.body.imageId,
        pendingKey: request.body.pendingKey,
        alt: request.body.alt,
        userId: user.id,
      });
    },
  );
};
