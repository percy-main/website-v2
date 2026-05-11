import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requireRole } from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import { getMatchdayReport, listGameReports } from "./game-reports-service.ts";
import {
  addMatchFeeRateResponseSchema,
  addMatchFeeRateSchema,
  archiveMemberResponseSchema,
  archiveMemberSchema,
  chargeAggregatesResponseSchema,
  chargeAggregatesSchema,
  chargeIdParamSchema,
  chargeNotificationResponseSchema,
  chargeNotificationSchema,
  chasePaymentResponseSchema,
  chasePaymentSchema,
  createChargeResponseSchema,
  createChargeSchema,
  createMemberResponseSchema,
  createMemberSchema,
  deleteChargeResponseSchema,
  deleteChargeSchema,
  deleteMatchFeeRateResponseSchema,
  findDuplicatesResponseSchema,
  getUserDetailResponseSchema,
  juniorTeamsResponseSchema,
  linkDependentResponseSchema,
  linkDependentSchema,
  linkParentResponseSchema,
  linkParentSchema,
  linkPlayCricketResponseSchema,
  linkSlugResponseSchema,
  listChargesResponseSchema,
  listChargesSchema,
  listContactSubmissionsResponseSchema,
  listContactSubmissionsSchema,
  listGameReportsResponseSchema,
  listGameReportsSchema,
  listJuniorsResponseSchema,
  listJuniorsSchema,
  listUsersResponseSchema,
  listUsersSchema,
  markChargePaidResponseSchema,
  markChargePaidSchema,
  matchFeeRatesResponseSchema,
  matchdayIdParamSchema,
  matchdayReportResponseSchema,
  mergeMembersResponseSchema,
  mergeMembersSchema,
  mergePreviewResponseSchema,
  mergePreviewSchema,
  playCricketPlayersResponseSchema,
  playCricketTeamsResponseSchema,
  rateIdParamSchema,
  recordLinkingResponseSchema,
  recordLinkingSchema,
  restoreMemberResponseSchema,
  searchMembersForParentLinkResponseSchema,
  searchMembersForParentLinkSchema,
  searchUsersForLinkingResponseSchema,
  searchUsersForLinkingSchema,
  setJuniorManagerTeamsResponseSchema,
  setJuniorManagerTeamsSchema,
  setMemberCategoryResponseSchema,
  setMemberCategorySchema,
  setOfficialTeamsResponseSchema,
  setOfficialTeamsSchema,
  slugLinkSchema,
  slugUnlinkSchema,
  unlinkDependentResponseSchema,
  unlinkDependentSchema,
  unlinkParentResponseSchema,
  unlinkParentSchema,
  unlinkPlayCricketResponseSchema,
  unlinkSchema,
  unlinkSlugResponseSchema,
  updateUserResponseSchema,
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
  linkDependentToUser,
  linkMemberParent,
  linkPlayCricketPlayer,
  linkSlug,
  listAllCharges,
  listContactSubmissions,
  listJuniors,
  listMatchFeeRates,
  listUsers,
  markChargePaid,
  mergeMembers,
  restoreMember,
  searchMembersForParentLink,
  searchUsersForLinking,
  sendChargeNotification,
  setJuniorManagerTeams,
  setMemberCategory,
  setOfficialTeams,
  unlinkDependentUser,
  unlinkMemberParent,
  unlinkPlayCricketPlayer,
  unlinkSlug,
  updateUser,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const list = listUsers(app.db);
  const update = updateUser(app.db);
  const create = createMember(app.db);
  const notify = sendChargeNotification(app.db);
  const recordLinking = getRecordLinking(app.db);
  const linkPC = linkPlayCricketPlayer(app.db);
  const unlinkPC = unlinkPlayCricketPlayer(app.db);
  const linkSl = linkSlug(app.db);
  const unlinkSl = unlinkSlug(app.db);
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
  const searchForParent = searchMembersForParentLink(app.db);
  const linkParent = linkMemberParent(app.db);
  const unlinkParent = unlinkMemberParent(app.db);
  const listCharges = listAllCharges(app.db);
  const chargeAggregates = getChargeAggregates(app.db);
  const chase = chasePayment(app.db);
  const markPaid = markChargePaid(app.db);
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
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listUsersSchema,
        response: { 200: listUsersResponseSchema },
      },
    },
    async (request) => {
      return await list(request.query);
    },
  );

  app.get(
    "/admin/users/:userId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        response: { 200: getUserDetailResponseSchema },
      },
    },
    async (request) => {
      return await detail(request.params.userId);
    },
  );

  app.put(
    "/admin/users/:userId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        body: updateUserSchema,
        response: { 200: updateUserResponseSchema },
      },
    },
    async (request) => {
      return await update(request.params.userId, request.body);
    },
  );

  app.put(
    "/admin/users/:userId/category",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        body: setMemberCategorySchema,
        response: { 200: setMemberCategoryResponseSchema },
      },
    },
    async (request) => {
      return await setCategory(
        request.params.userId,
        request.body.memberCategory,
      );
    },
  );

  app.post(
    "/admin/users/:userId/archive",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        body: archiveMemberSchema,
        response: { 200: archiveMemberResponseSchema },
      },
    },
    async (request) => {
      return await archive(request.params.userId, request.body.reason);
    },
  );

  app.post(
    "/admin/users/:userId/restore",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        response: { 200: restoreMemberResponseSchema },
      },
    },
    async (request) => {
      return await restore(request.params.userId);
    },
  );

  app.post(
    "/admin/users/:userId/charges",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        body: createChargeSchema,
        response: { 200: createChargeResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await addCharge(request.params.userId, user.id, request.body);
    },
  );

  app.delete(
    "/admin/charges/:chargeId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: chargeIdParamSchema,
        body: deleteChargeSchema,
        response: { 200: deleteChargeResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await removeCharge(
        request.params.chargeId,
        user.id,
        request.body.reason,
      );
    },
  );

  app.put(
    "/admin/users/:userId/junior-manager-teams",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        body: setJuniorManagerTeamsSchema,
        response: { 200: setJuniorManagerTeamsResponseSchema },
      },
    },
    async (request) => {
      return await setJrTeams(request.params.userId, request.body.teamIds);
    },
  );

  app.put(
    "/admin/users/:userId/official-teams",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: userIdParamSchema,
        body: setOfficialTeamsSchema,
        response: { 200: setOfficialTeamsResponseSchema },
      },
    },
    async (request) => {
      return await setOffTeams(request.params.userId, request.body.teamIds);
    },
  );

  app.get(
    "/admin/junior-teams",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: juniorTeamsResponseSchema },
      },
    },
    async () => {
      return await juniorTeams();
    },
  );

  app.get(
    "/admin/play-cricket-teams",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: playCricketTeamsResponseSchema },
      },
    },
    async () => {
      return await pcTeams();
    },
  );

  // Fetch players from the Play-Cricket external API (mirrors v1 refreshPlayCricketPlayers action)
  app.get(
    "/admin/play-cricket-players",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: playCricketPlayersResponseSchema },
      },
    },
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
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: createMemberSchema,
        response: { 200: createMemberResponseSchema },
      },
    },
    async (request) => {
      return await create(request.body);
    },
  );

  app.post(
    "/admin/charge-notification",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: chargeNotificationSchema,
        response: { 200: chargeNotificationResponseSchema },
      },
    },
    async (request) => {
      return await notify(request.body.userId);
    },
  );

  app.get(
    "/admin/record-linking",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: recordLinkingResponseSchema },
      },
    },
    async () => {
      return await recordLinking();
    },
  );

  app.post(
    "/admin/record-linking/play-cricket/link",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: recordLinkingSchema,
        response: { 200: linkPlayCricketResponseSchema },
      },
    },
    async (request) => {
      const { type, id, playCricketId } = request.body;
      return await linkPC(type, id, playCricketId);
    },
  );

  app.post(
    "/admin/record-linking/play-cricket/unlink",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: unlinkSchema,
        response: { 200: unlinkPlayCricketResponseSchema },
      },
    },
    async (request) => {
      const { type, id } = request.body;
      return await unlinkPC(type, id);
    },
  );

  app.post(
    "/admin/record-linking/slug/link",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: slugLinkSchema,
        response: { 200: linkSlugResponseSchema },
      },
    },
    async (request) => {
      return await linkSl(request.body.memberId, request.body.slug);
    },
  );

  app.post(
    "/admin/record-linking/slug/unlink",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: slugUnlinkSchema,
        response: { 200: unlinkSlugResponseSchema },
      },
    },
    async (request) => {
      return await unlinkSl(request.body.memberId);
    },
  );

  // --- Charges tab endpoints ---

  app.get(
    "/admin/charges",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listChargesSchema,
        response: { 200: listChargesResponseSchema },
      },
    },
    async (request) => {
      return await listCharges(request.query);
    },
  );

  app.get(
    "/admin/charge-aggregates",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: chargeAggregatesSchema,
        response: { 200: chargeAggregatesResponseSchema },
      },
    },
    async (request) => {
      return await chargeAggregates(request.query);
    },
  );

  app.post(
    "/admin/chase-payment",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: chasePaymentSchema,
        response: { 200: chasePaymentResponseSchema },
      },
    },
    async (request) => {
      return await chase(request.body.chargeId);
    },
  );

  app.post(
    "/admin/charges/:chargeId/mark-paid",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: chargeIdParamSchema,
        body: markChargePaidSchema,
        response: { 200: markChargePaidResponseSchema },
      },
    },
    async (request) => {
      return await markPaid(request.params.chargeId, request.body);
    },
  );

  // --- Contacts tab endpoints ---

  app.get(
    "/admin/contact-submissions",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listContactSubmissionsSchema,
        response: { 200: listContactSubmissionsResponseSchema },
      },
    },
    async (request) => {
      return await listContacts(request.query);
    },
  );

  // --- Juniors tab endpoints ---

  app.get(
    "/admin/juniors",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listJuniorsSchema,
        response: { 200: listJuniorsResponseSchema },
      },
    },
    async (request) => {
      return await listJr(request.query);
    },
  );

  app.get(
    "/admin/juniors/search-users",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: searchUsersForLinkingSchema,
        response: { 200: searchUsersForLinkingResponseSchema },
      },
    },
    async (request) => {
      return await searchForLinking(request.query);
    },
  );

  app.post(
    "/admin/juniors/link",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: linkDependentSchema,
        response: { 200: linkDependentResponseSchema },
      },
    },
    async (request) => {
      return await linkDep(request.body);
    },
  );

  app.post(
    "/admin/juniors/unlink",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: unlinkDependentSchema,
        response: { 200: unlinkDependentResponseSchema },
      },
    },
    async (request) => {
      return await unlinkDep(request.body);
    },
  );

  app.get(
    "/admin/members/parent-search",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: searchMembersForParentLinkSchema,
        response: { 200: searchMembersForParentLinkResponseSchema },
      },
    },
    async (request) => {
      return await searchForParent(request.query);
    },
  );

  app.post(
    "/admin/members/parent-link",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: linkParentSchema,
        response: { 200: linkParentResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await linkParent(request.body, user.id);
    },
  );

  app.post(
    "/admin/members/parent-unlink",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: unlinkParentSchema,
        response: { 200: unlinkParentResponseSchema },
      },
    },
    async (request) => {
      return await unlinkParent(request.body);
    },
  );

  // --- Duplicates tab endpoints ---

  app.get(
    "/admin/duplicates",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: findDuplicatesResponseSchema },
      },
    },
    async () => {
      return await findDuplicates();
    },
  );

  app.get(
    "/admin/merge-preview",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: mergePreviewSchema,
        response: { 200: mergePreviewResponseSchema },
      },
    },
    async (request) => {
      return await previewMerge(request.query);
    },
  );

  app.post(
    "/admin/merge-members",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: mergeMembersSchema,
        response: { 200: mergeMembersResponseSchema },
      },
    },
    async (request) => {
      return await merge(request.body);
    },
  );

  // --- Match fee rates endpoints ---

  app.get(
    "/admin/match-fee-rates",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: matchFeeRatesResponseSchema },
      },
    },
    async () => {
      return await listFeeRates();
    },
  );

  app.post(
    "/admin/match-fee-rates",
    {
      preHandler: [requireRole("admin")],
      schema: {
        body: addMatchFeeRateSchema,
        response: { 200: addMatchFeeRateResponseSchema },
      },
    },
    async (request) => {
      return await addFeeRate(request.body);
    },
  );

  app.delete(
    "/admin/match-fee-rates/:rateId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: rateIdParamSchema,
        response: { 200: deleteMatchFeeRateResponseSchema },
      },
    },
    async (request) => {
      return await deleteFeeRate(request.params.rateId);
    },
  );

  // --- Game Reports tab endpoints ---

  app.get(
    "/admin/game-reports",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: listGameReportsSchema,
        response: { 200: listGameReportsResponseSchema },
      },
    },
    async (request) => {
      return await listReports(request.query);
    },
  );

  app.get(
    "/admin/game-reports/:matchdayId",
    {
      preHandler: [requireRole("admin")],
      schema: {
        params: matchdayIdParamSchema,
        response: { 200: matchdayReportResponseSchema },
      },
    },
    async (request) => {
      return await getReport(request.params.matchdayId);
    },
  );
};
