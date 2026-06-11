import {
  checkPermission,
  type Action,
} from "@percy-main/shared/auth/permissions";
import {
  CONTENT_KIND_RESOURCES,
  type ContentKind,
} from "@percy-main/shared/content";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { getAuthSession, requireAuth } from "../auth/middleware.ts";
import {
  contentDetailResponseSchema,
  contentIdParamSchema,
  createContentSchema,
  goneResponseSchema,
  listContentQuerySchema,
  listContentResponseSchema,
  listEventsResponseSchema,
  listNewsQuerySchema,
  listNewsResponseSchema,
  listPeopleResponseSchema,
  listRevisionsResponseSchema,
  navResponseSchema,
  pageByPathQuerySchema,
  pageTreeResponseSchema,
  playCricketIdParamSchema,
  publicContentParamsSchema,
  publicContentResponseSchema,
  publishContentSchema,
  updateContentSchema,
} from "./schemas.ts";
import {
  archiveContent,
  createContent,
  getContent,
  getContentMeta,
  getPublishedContent,
  getPublishedGameReport,
  getPublishedNav,
  getPublishedPageByPath,
  listContent,
  listPageTree,
  listPublishedEvents,
  listPublishedNews,
  listPublishedPeople,
  listRevisions,
  publishContent,
  unpublishContent,
  updateContent,
} from "./service.ts";

/**
 * Per-kind permission gate. The resource depends on the item's kind
 * (content / content_news / content_reports / content_people), which for
 * most routes is only known from the body or the existing row - so this
 * runs in the handler after requireAuth, not as a static preHandler.
 */
function assertContentPermission(
  request: FastifyRequest,
  kind: ContentKind,
  action: Action<"content">,
) {
  const { user } = getAuthSession(request);
  const role = (user as { role?: string | null }).role ?? "user";
  if (!checkPermission(role, CONTENT_KIND_RESOURCES[kind], action)) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
}

const idResponseSchema = z.object({ id: z.string() });
const publishResponseSchema = z.object({
  id: z.string(),
  publishedAt: z.string().nullable(),
});

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const contentRoutes: FastifyPluginAsyncZod = async (app) => {
  const list = listContent(app.db);
  const pageTree = listPageTree(app.db);
  const get = getContent(app.db);
  const metaOf = getContentMeta(app.db);
  const create = createContent(app.db);
  const update = updateContent(app.db);
  const publish = publishContent(app.db);
  const unpublish = unpublishContent(app.db);
  const archive = archiveContent(app.db);
  const revisions = listRevisions(app.db);
  const publicGet = getPublishedContent(app.db);
  const publicGameReport = getPublishedGameReport(app.db);
  const publicNews = listPublishedNews(app.db);
  const publicEvents = listPublishedEvents(app.db);
  const publicPeople = listPublishedPeople(app.db);
  const publicNav = getPublishedNav(app.db);
  const publicPageByPath = getPublishedPageByPath(app.db);

  // ── Admin ──

  app.get(
    "/admin/content",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: listContentQuerySchema,
        response: { 200: listContentResponseSchema },
      },
    },
    async (request) => {
      assertContentPermission(request, request.query.kind, "view");
      return await list(request.query);
    },
  );

  // Static segment, so find-my-way prefers it over /admin/content/:contentId.
  // Same permission treatment as the admin list for kind=page (resource
  // "content", action "view").
  app.get(
    "/admin/content/page-tree",
    {
      preHandler: [requireAuth],
      schema: {
        response: { 200: pageTreeResponseSchema },
      },
    },
    async (request) => {
      assertContentPermission(request, "page", "view");
      return await pageTree();
    },
  );

  app.get(
    "/admin/content/:contentId",
    {
      preHandler: [requireAuth],
      schema: {
        params: contentIdParamSchema,
        response: { 200: contentDetailResponseSchema },
      },
    },
    async (request) => {
      const item = await get(request.params.contentId);
      assertContentPermission(request, item.kind, "view");
      return item;
    },
  );

  app.post(
    "/admin/content",
    {
      preHandler: [requireAuth],
      schema: {
        body: createContentSchema,
        response: { 200: idResponseSchema },
      },
    },
    async (request) => {
      assertContentPermission(request, request.body.kind, "manage");
      const { user } = getAuthSession(request);
      return await create({ ...request.body, userId: user.id });
    },
  );

  app.put(
    "/admin/content/:contentId",
    {
      preHandler: [requireAuth],
      schema: {
        params: contentIdParamSchema,
        body: updateContentSchema,
        response: { 200: idResponseSchema },
      },
    },
    async (request) => {
      const { kind, status } = await metaOf(request.params.contentId);
      assertContentPermission(request, kind, "manage");
      // Editing a published item changes the live page instantly (single
      // body, no staged drafts), so it needs the publish action too. Today
      // every content role has both; this keeps the manage/publish split
      // meaningful if a review tier is added later.
      if (status === "published") {
        assertContentPermission(request, kind, "publish");
      }
      const { user } = getAuthSession(request);
      return await update({
        ...request.body,
        contentId: request.params.contentId,
        userId: user.id,
      });
    },
  );

  app.post(
    "/admin/content/:contentId/publish",
    {
      preHandler: [requireAuth],
      schema: {
        params: contentIdParamSchema,
        body: publishContentSchema,
        response: { 200: publishResponseSchema },
      },
    },
    async (request) => {
      const { kind } = await metaOf(request.params.contentId);
      assertContentPermission(request, kind, "publish");
      const { user } = getAuthSession(request);
      return await publish({
        contentId: request.params.contentId,
        publishedAt: request.body?.publishedAt,
        userId: user.id,
      });
    },
  );

  app.post(
    "/admin/content/:contentId/unpublish",
    {
      preHandler: [requireAuth],
      schema: {
        params: contentIdParamSchema,
        response: { 200: idResponseSchema },
      },
    },
    async (request) => {
      const { kind } = await metaOf(request.params.contentId);
      assertContentPermission(request, kind, "publish");
      const { user } = getAuthSession(request);
      return await unpublish({
        contentId: request.params.contentId,
        userId: user.id,
      });
    },
  );

  app.post(
    "/admin/content/:contentId/archive",
    {
      preHandler: [requireAuth],
      schema: {
        params: contentIdParamSchema,
        response: { 200: idResponseSchema },
      },
    },
    async (request) => {
      const { kind } = await metaOf(request.params.contentId);
      assertContentPermission(request, kind, "manage");
      const { user } = getAuthSession(request);
      return await archive({
        contentId: request.params.contentId,
        userId: user.id,
      });
    },
  );

  app.get(
    "/admin/content/:contentId/revisions",
    {
      preHandler: [requireAuth],
      schema: {
        params: contentIdParamSchema,
        response: { 200: listRevisionsResponseSchema },
      },
    },
    async (request) => {
      const { kind } = await metaOf(request.params.contentId);
      assertContentPermission(request, kind, "view");
      return await revisions(request.params.contentId);
    },
  );

  // ── Public (no auth) ──
  //
  // Serves only status='published' AND published_at <= now(). The API is
  // not behind CloudFront, so publish-to-visible is instant; ETag/304
  // keeps repeat navigation cheap without any invalidation machinery.

  // Strong ETag from id + last modification time; Fastify discards the
  // body it is handed on a 304, so send(null) produces an empty response.
  const etagFor = (item: { id: string; updatedAt: string }) =>
    `"${item.id}-${Date.parse(item.updatedAt)}"`;

  app.get(
    "/content/game-report/by-play-cricket-id/:playCricketId",
    {
      schema: {
        params: playCricketIdParamSchema,
        response: { 200: publicContentResponseSchema, 304: z.null() },
      },
    },
    async (request, reply) => {
      const item = await publicGameReport(request.params.playCricketId);
      const etag = etagFor(item);
      void reply.header("etag", etag);
      if (request.headers["if-none-match"] === etag) {
        return await reply.code(304).send(null);
      }
      return item;
    },
  );

  app.get(
    "/content/:kind/:slug",
    {
      schema: {
        params: publicContentParamsSchema,
        response: { 200: publicContentResponseSchema, 304: z.null() },
      },
    },
    async (request, reply) => {
      const item = await publicGet(request.params);
      const etag = etagFor(item);
      void reply.header("etag", etag);
      if (request.headers["if-none-match"] === etag) {
        return await reply.code(304).send(null);
      }
      return item;
    },
  );

  // Page lookup by full materialised path - the canonical public page
  // route (nested page slugs are only unique among siblings). Static
  // segments, so find-my-way prefers it over /content/:kind/:slug.
  // 410 = tombstone: the page WAS live here but has been taken down;
  // the SPA must not fall back to its bundled static version (404 keeps
  // that fallback for never-live paths).
  app.get(
    "/content/page/by-path",
    {
      schema: {
        querystring: pageByPathQuerySchema,
        response: {
          200: publicContentResponseSchema,
          304: z.null(),
          410: goneResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const item = await publicPageByPath(request.query.path);
      const etag = etagFor(item);
      void reply.header("etag", etag);
      if (request.headers["if-none-match"] === etag) {
        return await reply.code(304).send(null);
      }
      return item;
    },
  );

  // List endpoints. One static segment, so no clash with the two-segment
  // /content/:kind/:slug above. No ETag here: any item edit, publish or
  // scheduled publish crossing now() would have to invalidate it.

  app.get(
    "/content/news",
    {
      schema: {
        querystring: listNewsQuerySchema,
        response: { 200: listNewsResponseSchema },
      },
    },
    async (request) => {
      return await publicNews(request.query);
    },
  );

  app.get(
    "/content/events",
    {
      schema: {
        response: { 200: listEventsResponseSchema },
      },
    },
    async () => {
      return await publicEvents();
    },
  );

  app.get(
    "/content/people",
    {
      schema: {
        response: { 200: listPeopleResponseSchema },
      },
    },
    async () => {
      return await publicPeople();
    },
  );

  app.get(
    "/content/nav",
    {
      schema: {
        response: { 200: navResponseSchema },
      },
    },
    async () => {
      return await publicNav();
    },
  );
};
