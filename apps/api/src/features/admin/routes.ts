import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.ts";
import { getAuthSession, requireRole } from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import { getMatchdayReport, listGameReports } from "./game-reports-service.ts";
import {
  addMatchFeeRateSchema,
  archiveMemberSchema,
  chargeAggregatesSchema,
  chargeIdParamSchema,
  chargeNotificationSchema,
  chasePaymentSchema,
  contentfulLinkSchema,
  contentfulUnlinkSchema,
  createChargeSchema,
  createMemberSchema,
  deleteChargeSchema,
  linkDependentSchema,
  listChargesSchema,
  listContactSubmissionsSchema,
  listGameReportsSchema,
  listJuniorsSchema,
  listUsersSchema,
  matchdayIdParamSchema,
  mergeMembersSchema,
  mergePreviewSchema,
  rateIdParamSchema,
  recordLinkingSchema,
  searchUsersForLinkingSchema,
  setJuniorManagerTeamsSchema,
  setMemberCategorySchema,
  setOfficialTeamsSchema,
  unlinkDependentSchema,
  unlinkSchema,
  updateUserSchema,
  userIdParamSchema,
} from "./schemas.ts";
import {
  addMatchFeeRate,
  archiveMember,
  chasePayment,
  createCharge,
  createMember,
  deleteCharge,
  deleteMatchFeeRate,
  findDuplicateMembers,
  getAllJuniorTeams,
  getAllPlayCricketTeams,
  getChargeAggregates,
  getMergePreview,
  getRecordLinking,
  getUserDetail,
  linkContentfulPerson,
  linkDependentToUser,
  linkPlayCricketPlayer,
  listAllCharges,
  listContactSubmissions,
  listJuniors,
  listMatchFeeRates,
  listUsers,
  mergeMembers,
  restoreMember,
  searchUsersForLinking,
  sendChargeNotification,
  setJuniorManagerTeams,
  setMemberCategory,
  setOfficialTeams,
  unlinkContentfulPerson,
  unlinkDependentUser,
  unlinkPlayCricketPlayer,
  updateUser,
} from "./service.ts";

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
  const listJr = listJuniors(app.db);
  const searchForLinking = searchUsersForLinking(app.db);
  const linkDep = linkDependentToUser(app.db);
  const unlinkDep = unlinkDependentUser(app.db);
  const listCharges = listAllCharges(app.db);
  const chargeAggregates = getChargeAggregates(app.db);
  const chase = chasePayment(app.db);
  const listContacts = listContactSubmissions(app.db);
  const findDuplicates = findDuplicateMembers(app.db);
  const previewMerge = getMergePreview(app.db);
  const merge = mergeMembers(app.db);
  const listFeeRates = listMatchFeeRates(app.db);
  const addFeeRate = addMatchFeeRate(app.db);
  const deleteFeeRate = deleteMatchFeeRate(app.db);
  const listReports = listGameReports(app.db);
  const getReport = getMatchdayReport(app.db);

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
      const { user } = getAuthSession(request);
      const data = parseBody(request, createChargeSchema);
      return await addCharge(userId, user.id, data);
    },
  );

  app.delete(
    "/admin/charges/:chargeId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { chargeId } = parseParams(request, chargeIdParamSchema);
      const { user } = getAuthSession(request);
      const { reason } = parseBody(request, deleteChargeSchema);
      return await removeCharge(chargeId, user.id, reason);
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

  // Fetch players from the Play-Cricket external API (mirrors v1 refreshPlayCricketPlayers action)
  app.get(
    "/admin/play-cricket-players",
    { preHandler: [requireRole("admin")] },
    async () => {
      if (
        !app.config.PLAY_CRICKET_API_TOKEN ||
        !app.config.PLAY_CRICKET_SITE_ID
      ) {
        const error = new Error("Play-Cricket API not configured") as Error & {
          statusCode: number;
        };
        error.statusCode = 503;
        throw error;
      }
      const pcApi = createApiClient({
        apiToken: app.config.PLAY_CRICKET_API_TOKEN,
        siteId: app.config.PLAY_CRICKET_SITE_ID,
      });
      const { players } = await pcApi.getPlayers();
      return {
        players: players.map((p) => ({
          memberId: p.member_id,
          name: p.name,
        })),
      };
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

  // --- Charges tab endpoints ---

  app.get(
    "/admin/charges",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, listChargesSchema);
      return await listCharges(params);
    },
  );

  app.get(
    "/admin/charge-aggregates",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, chargeAggregatesSchema);
      return await chargeAggregates(params);
    },
  );

  app.post(
    "/admin/chase-payment",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { chargeId } = parseBody(request, chasePaymentSchema);
      return await chase(chargeId);
    },
  );

  // --- Contacts tab endpoints ---

  app.get(
    "/admin/contact-submissions",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, listContactSubmissionsSchema);
      return await listContacts(params);
    },
  );

  // --- Juniors tab endpoints ---

  app.get(
    "/admin/juniors",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, listJuniorsSchema);
      return await listJr(params);
    },
  );

  app.get(
    "/admin/juniors/search-users",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, searchUsersForLinkingSchema);
      return await searchForLinking(params);
    },
  );

  app.post(
    "/admin/juniors/link",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseBody(request, linkDependentSchema);
      return await linkDep(params);
    },
  );

  app.post(
    "/admin/juniors/unlink",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseBody(request, unlinkDependentSchema);
      return await unlinkDep(params);
    },
  );

  // --- Duplicates tab endpoints ---

  app.get(
    "/admin/duplicates",
    { preHandler: [requireRole("admin")] },
    async () => {
      return await findDuplicates();
    },
  );

  app.get(
    "/admin/merge-preview",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, mergePreviewSchema);
      return await previewMerge(params);
    },
  );

  app.post(
    "/admin/merge-members",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseBody(request, mergeMembersSchema);
      return await merge(params);
    },
  );

  // --- Match fee rates endpoints ---

  app.get(
    "/admin/match-fee-rates",
    { preHandler: [requireRole("admin")] },
    async () => {
      return await listFeeRates();
    },
  );

  app.post(
    "/admin/match-fee-rates",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseBody(request, addMatchFeeRateSchema);
      return await addFeeRate(params);
    },
  );

  app.delete(
    "/admin/match-fee-rates/:rateId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { rateId } = parseParams(request, rateIdParamSchema);
      return await deleteFeeRate(rateId);
    },
  );

  // --- Game Reports tab endpoints ---

  app.get(
    "/admin/game-reports",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const params = parseQuery(request, listGameReportsSchema);
      return await listReports(params);
    },
  );

  app.get(
    "/admin/game-reports/:matchdayId",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { matchdayId } = parseParams(request, matchdayIdParamSchema);
      return await getReport(matchdayId);
    },
  );
};
