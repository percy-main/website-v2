import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/middleware.js";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.js";
import {
  listUsersSchema,
  updateUserSchema,
  userIdParamSchema,
  createMemberSchema,
  chargeNotificationSchema,
  recordLinkingSchema,
  unlinkSchema,
  contentfulLinkSchema,
  contentfulUnlinkSchema,
} from "./schemas.js";
import {
  listUsers,
  updateUser,
  createMember,
  sendChargeNotification,
  getRecordLinking,
  linkPlayCricketPlayer,
  unlinkPlayCricketPlayer,
  linkContentfulPerson,
  unlinkContentfulPerson,
} from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const adminRoutes: FastifyPluginAsync = async (app) => {
  const list = listUsers(app.db);
  const update = updateUser(app.db);
  const create = createMember(app.db);
  const notify = sendChargeNotification(app.db);
  const recordLinking = getRecordLinking(app.db);
  const linkPC = linkPlayCricketPlayer(app.db);
  const unlinkPC = unlinkPlayCricketPlayer(app.db);
  const linkCF = linkContentfulPerson(app.db);
  const unlinkCF = unlinkContentfulPerson(app.db);

  app.get(
    "/admin/users",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, listUsersSchema);
      return await list(params);
    },
  );

  app.put(
    "/admin/users/:userId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      const data = parseBody(request, updateUserSchema);
      return await update(userId, data);
    },
  );

  app.post(
    "/admin/members",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const data = parseBody(request, createMemberSchema);
      return await create(data);
    },
  );

  app.post(
    "/admin/charge-notification",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseBody(request, chargeNotificationSchema);
      return await notify(userId);
    },
  );

  app.get(
    "/admin/record-linking",
    { preHandler: [requireRole("admin")] },
    async () => {
      return await recordLinking();
    },
  );

  app.post(
    "/admin/record-linking/play-cricket/link",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { type, id, playCricketId } = parseBody(
        request,
        recordLinkingSchema,
      );
      return await linkPC(type, id, playCricketId);
    },
  );

  app.post(
    "/admin/record-linking/play-cricket/unlink",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { type, id } = parseBody(request, unlinkSchema);
      return await unlinkPC(type, id);
    },
  );

  app.post(
    "/admin/record-linking/contentful/link",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { memberId, contentfulEntryId } = parseBody(
        request,
        contentfulLinkSchema,
      );
      return await linkCF(memberId, contentfulEntryId);
    },
  );

  app.post(
    "/admin/record-linking/contentful/unlink",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { memberId } = parseBody(request, contentfulUnlinkSchema);
      return await unlinkCF(memberId);
    },
  );
};
