import { renderToBuffer } from "@react-pdf/renderer";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import {
  getAuthSession,
  requireAnyPermission,
  requirePermission,
} from "../auth/middleware.ts";
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
  editChargeResponseSchema,
  editChargeSchema,
  findDuplicatesResponseSchema,
  getUserDetailResponseSchema,
  juniorTeamsResponseSchema,
  linkDependentResponseSchema,
  linkDependentSchema,
  linkParentResponseSchema,
  linkParentSchema,
  linkPlayCricketResponseSchema,
  linkSlugResponseSchema,
  listAccessUsersResponseSchema,
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
  searchUsersForAccessResponseSchema,
  searchUsersForAccessSchema,
  searchUsersForLinkingResponseSchema,
  searchUsersForLinkingSchema,
  setMemberCategoryResponseSchema,
  setMemberCategorySchema,
  slugLinkSchema,
  slugUnlinkSchema,
  unlinkDependentResponseSchema,
  unlinkDependentSchema,
  unlinkParentResponseSchema,
  unlinkParentSchema,
  unlinkPlayCricketResponseSchema,
  unlinkSchema,
  unlinkSlugResponseSchema,
  updateAccessAssignmentsResponseSchema,
  updateAccessAssignmentsSchema,
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
  editCharge,
  findDuplicateMembers,
  getAllJuniorTeams,
  getAllPlayCricketTeams,
  getChargeAggregates,
  getMergePreview,
  getRecordLinking,
  getUnpaidChargesGroupedByMember,
  getUserDetail,
  linkDependentToUser,
  linkMemberParent,
  linkPlayCricketPlayer,
  linkSlug,
  listAccessUsers,
  listAllCharges,
  listContactSubmissions,
  listJuniors,
  listMatchFeeRates,
  listUsers,
  markChargePaid,
  mergeMembers,
  restoreMember,
  searchMembersForParentLink,
  searchUsersForAccess,
  searchUsersForLinking,
  sendChargeNotification,
  setMemberCategory,
  unlinkDependentUser,
  unlinkMemberParent,
  unlinkPlayCricketPlayer,
  unlinkSlug,
  updateAccessAssignments,
  updateUser,
} from "./service.ts";
import { UnpaidChargesPdf } from "./unpaid-charges-pdf.tsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLUB_LOGO_PNG = readFileSync(
  join(__dirname, "..", "..", "assets", "club_logo.png"),
);

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  // Permission gates used by the admin portal. The legacy `admin` role still
  // satisfies all of these via the all-perms bundle in shared/permissions.
  const usersView = requirePermission("users", "view");
  const usersManage = requirePermission("users", "manage");
  const usersManageRoles = requirePermission("users", "manage_roles");
  const financeView = requirePermission("finance", "view");
  const financeManage = requirePermission("finance", "manage");
  const matchdayView = requirePermission("matchday", "view");
  const juniorsView = requirePermission("juniors", "view");
  const juniorsManage = requirePermission("juniors", "manage");
  const marketingView = requirePermission("marketing", "view");
  const list = listUsers(app.db);
  const update = updateUser(app.db);
  const create = createMember(app.db);
  const notify = sendChargeNotification(app.db, app.send, app.config);
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
  const unpaidChargesForPdf = getUnpaidChargesGroupedByMember(app.db);
  const chase = chasePayment(app.db, app.send, app.config);
  const markPaid = markChargePaid(app.db);
  const edit = editCharge(app.db);
  const listContacts = listContactSubmissions(app.db);
  const findDuplicates = findDuplicateMembers(app.db);
  const previewMerge = getMergePreview(app.db);
  const merge = mergeMembers(app.db);
  const listFeeRates = listMatchFeeRates(app.db);
  const addFeeRate = addMatchFeeRate(app.db);
  const deleteFeeRate = deleteMatchFeeRate(app.db);
  const listReports = listGameReports(app.db);
  const getReport = getMatchdayReport(app.db);
  const accessUsers = listAccessUsers(app.db);
  const searchForAccess = searchUsersForAccess(app.db);
  const updateAssignments = updateAccessAssignments(app.db);

  // --- Access tab endpoints (superadmin only via users.manage_roles) ---

  app.get(
    "/admin/access/users",
    {
      preHandler: [usersManageRoles],
      schema: {
        response: { 200: listAccessUsersResponseSchema },
      },
    },
    async () => {
      return await accessUsers();
    },
  );

  app.get(
    "/admin/access/search",
    {
      preHandler: [usersManageRoles],
      schema: {
        querystring: searchUsersForAccessSchema,
        response: { 200: searchUsersForAccessResponseSchema },
      },
    },
    async (request) => {
      return await searchForAccess(request.query);
    },
  );

  // Atomic role + per-team scope update. Bypasses better-auth's setRole so
  // user.role and the join tables move together in one transaction.
  app.put(
    "/admin/access/users/:userId/assignments",
    {
      preHandler: [usersManageRoles],
      schema: {
        params: userIdParamSchema,
        body: updateAccessAssignmentsSchema,
        response: { 200: updateAccessAssignmentsResponseSchema },
      },
    },
    async (request) => {
      return await updateAssignments(request.params.userId, request.body);
    },
  );

  app.get(
    "/admin/users",
    {
      preHandler: [usersView],
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
      preHandler: [usersView],
      schema: {
        params: userIdParamSchema,
        response: { 200: getUserDetailResponseSchema },
      },
    },
    async (request) => {
      return await detail(request.params.userId);
    },
  );

  // Role is no longer a field on updateUserSchema — role assignment lives in
  // the Access tab. Profile edits (name, email, banned, banReason) are
  // gated by users.manage rather than users.manage_roles.
  app.put(
    "/admin/users/:userId",
    {
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [financeManage],
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
      preHandler: [financeManage],
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

  // Team-list endpoints are reference data consumed by feature admins AND
  // by the Access tab's role-assignment workflow. Open to anyone with the
  // feature view OR with users.manage_roles (superadmin) so a standalone
  // superadmin can assign scoped junior_manager / official roles.
  app.get(
    "/admin/junior-teams",
    {
      preHandler: [
        requireAnyPermission(
          { resource: "juniors", action: "view" },
          { resource: "users", action: "manage_roles" },
        ),
      ],
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
      preHandler: [
        requireAnyPermission(
          { resource: "matchday", action: "view" },
          { resource: "users", action: "manage_roles" },
        ),
      ],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [financeManage],
      schema: {
        body: chargeNotificationSchema,
        response: { 200: chargeNotificationResponseSchema },
      },
    },
    async (request) => {
      return await notify(request.body.userId, request.log);
    },
  );

  app.get(
    "/admin/record-linking",
    {
      preHandler: [usersView],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [financeView],
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
    "/admin/charges/unpaid-pdf",
    {
      preHandler: [financeView],
    },
    async (_request, reply) => {
      const { groups, grandTotalPence } = await unpaidChargesForPdf();
      const generatedAt = new Date().toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const doc = React.createElement(UnpaidChargesPdf, {
        groups,
        grandTotalPence,
        generatedAt,
        logoPng: CLUB_LOGO_PNG,
      });
      const pdf = await renderToBuffer(
        doc as unknown as Parameters<typeof renderToBuffer>[0],
      );
      const filename = `unpaid-charges-${new Date().toISOString().slice(0, 10)}.pdf`;
      return await reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(pdf);
    },
  );

  app.get(
    "/admin/charge-aggregates",
    {
      preHandler: [financeView],
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
      preHandler: [financeManage],
      schema: {
        body: chasePaymentSchema,
        response: { 200: chasePaymentResponseSchema },
      },
    },
    async (request) => {
      return await chase(request.body.chargeId, request.log);
    },
  );

  app.post(
    "/admin/charges/:chargeId/mark-paid",
    {
      preHandler: [financeManage],
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

  app.post(
    "/admin/charges/:chargeId/edit",
    {
      preHandler: [financeManage],
      schema: {
        params: chargeIdParamSchema,
        body: editChargeSchema,
        response: { 200: editChargeResponseSchema },
      },
    },
    async (request) => {
      return await edit(request.params.chargeId, request.body);
    },
  );

  // --- Contacts tab endpoints ---

  app.get(
    "/admin/contact-submissions",
    {
      preHandler: [marketingView],
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
      preHandler: [juniorsView],
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
      preHandler: [juniorsView],
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
      preHandler: [juniorsManage],
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
      preHandler: [juniorsManage],
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
      preHandler: [usersView],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [usersManage],
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
      preHandler: [financeView],
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
      preHandler: [financeManage],
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
      preHandler: [financeManage],
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
      preHandler: [matchdayView],
      schema: {
        querystring: listGameReportsSchema,
        response: { 200: listGameReportsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await listReports(user.id, role, request.query);
    },
  );

  app.get(
    "/admin/game-reports/:matchdayId",
    {
      preHandler: [matchdayView],
      schema: {
        params: matchdayIdParamSchema,
        response: { 200: matchdayReportResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await getReport(user.id, role, request.params.matchdayId);
    },
  );
};
