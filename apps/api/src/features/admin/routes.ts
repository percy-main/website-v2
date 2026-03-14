import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/middleware.js";
import { parseBody, parseQuery } from "../../lib/validation.js";
import {
  listUsersSchema,
  updateUserSchema,
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
      return list(params);
    },
  );

  app.put<{ Params: { userId: string } }>(
    "/admin/users/:userId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = request.params;
      const data = parseBody(request, updateUserSchema);
      return update(userId, data);
    },
  );

  app.post(
    "/admin/members",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const data = parseBody(request, createMemberSchema);
      return create(data);
    },
  );

  app.post(
    "/admin/charge-notification",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseBody(request, chargeNotificationSchema);
      return notify(userId);
    },
  );

  app.get(
    "/admin/record-linking",
    { preHandler: [requireRole("admin")] },
    async () => {
      return recordLinking();
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
      return linkPC(type, id, playCricketId);
    },
  );

  app.post(
    "/admin/record-linking/play-cricket/unlink",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { type, id } = parseBody(request, unlinkSchema);
      return unlinkPC(type, id);
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
      return linkCF(memberId, contentfulEntryId);
    },
  );

  app.post(
    "/admin/record-linking/contentful/unlink",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { memberId } = parseBody(request, contentfulUnlinkSchema);
      return unlinkCF(memberId);
    },
  );
};
