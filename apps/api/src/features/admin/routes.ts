import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.js";
import { requireRole } from "../auth/middleware.js";
import {
  archiveMemberSchema,
  chargeIdParamSchema,
  chargeNotificationSchema,
  contentfulLinkSchema,
  contentfulUnlinkSchema,
  createChargeSchema,
  createMemberSchema,
  deleteChargeSchema,
  listUsersSchema,
  recordLinkingSchema,
  setJuniorManagerTeamsSchema,
  setMemberCategorySchema,
  setOfficialTeamsSchema,
  unlinkSchema,
  updateUserSchema,
  userIdParamSchema,
} from "./schemas.js";
import {
  archiveMember,
  createCharge,
  createMember,
  deleteCharge,
  getAllJuniorTeams,
  getAllPlayCricketTeams,
  getRecordLinking,
  getUserDetail,
  linkContentfulPerson,
  linkPlayCricketPlayer,
  listUsers,
  restoreMember,
  sendChargeNotification,
  setJuniorManagerTeams,
  setMemberCategory,
  setOfficialTeams,
  unlinkContentfulPerson,
  unlinkPlayCricketPlayer,
  updateUser,
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
  const detail = getUserDetail(app.db);
  const setCategory = setMemberCategory(app.db);
  const archive = archiveMember(app.db);
  const restore = restoreMember(app.db);
  const addCharge = createCharge(app.db);
  const removeCharge = deleteCharge(app.db);
  const setJrTeams = setJuniorManagerTeams(app.db);
  const setOffTeams = setOfficialTeams(app.db);
  const juniorTeams = getAllJuniorTeams(app.db);
  const pcTeams = getAllPlayCricketTeams(app.db);

  app.get(
    "/admin/users",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, listUsersSchema);
      return await list(params);
    },
  );

  app.get(
    "/admin/users/:userId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      return await detail(userId);
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

  app.put(
    "/admin/users/:userId/category",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      const { memberCategory } = parseBody(request, setMemberCategorySchema);
      return await setCategory(userId, memberCategory);
    },
  );

  app.post(
    "/admin/users/:userId/archive",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      const { reason } = parseBody(request, archiveMemberSchema);
      return await archive(userId, reason);
    },
  );

  app.post(
    "/admin/users/:userId/restore",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      return await restore(userId);
    },
  );

  app.post(
    "/admin/users/:userId/charges",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      const data = parseBody(request, createChargeSchema);
      return await addCharge(userId, data);
    },
  );

  app.delete(
    "/admin/charges/:chargeId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { chargeId } = parseParams(request, chargeIdParamSchema);
      const { reason } = parseBody(request, deleteChargeSchema);
      return await removeCharge(chargeId, reason);
    },
  );

  app.put(
    "/admin/users/:userId/junior-manager-teams",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      const { teamIds } = parseBody(request, setJuniorManagerTeamsSchema);
      return await setJrTeams(userId, teamIds);
    },
  );

  app.put(
    "/admin/users/:userId/official-teams",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { userId } = parseParams(request, userIdParamSchema);
      const { teamIds } = parseBody(request, setOfficialTeamsSchema);
      return await setOffTeams(userId, teamIds);
    },
  );

  app.get(
    "/admin/junior-teams",
    { preHandler: [requireRole("admin")] },
    async () => {
      return await juniorTeams();
    },
  );

  app.get(
    "/admin/play-cricket-teams",
    { preHandler: [requireRole("admin")] },
    async () => {
      return await pcTeams();
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
