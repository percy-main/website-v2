import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAuth,
  requirePermission,
} from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import {
  addPlayerResponseSchema,
  addPlayerSchema,
  allPastUnfinishedMatchdaysResponseSchema,
  cancelMatchdaySchema,
  createMatchdayResponseSchema,
  createMatchdaySchema,
  expenseIdParamSchema,
  finishMatchResponseSchema,
  finishMatchSchema,
  getMatchResponseSchema,
  listMatchesResponseSchema,
  listMatchesSchema,
  listPendingExpensesResponseSchema,
  listPendingExpensesSchema,
  listTeamsResponseSchema,
  markPaidSchema,
  matchIdParamSchema,
  pastUnfinishedMatchdaysResponseSchema,
  playerIdParamSchema,
  publicMatchdayResponseSchema,
  recordExpenseResponseSchema,
  recordExpenseSchema,
  rejectExpenseSchema,
  searchMembersResponseSchema,
  searchMembersSchema,
  setRolesSchema,
  submitExpenseResponseSchema,
  submitExpenseSchema,
  successResponseSchema,
  teamIdParamSchema,
  teamNewsImageQuerySchema,
  upcomingMatchesResponseSchema,
  updateExpenseSchema,
} from "./schemas.ts";
import {
  addPlayer,
  approveExpense,
  cancelMatchday,
  createMatchday,
  deleteExpense,
  finishMatch,
  getAllPastUnfinishedMatchdays,
  getMatch,
  getMatchPublic,
  getPastUnfinishedMatchdays,
  getTeamNewsData,
  getUpcomingMatches,
  listMatches,
  listPendingExpenses,
  listTeams,
  markExpenseReimbursed,
  markFeePaid,
  recordExpense,
  rejectExpense,
  removePlayer,
  searchMembers,
  setMatchRoles,
  submitExpenseClaim,
  updateExpense,
} from "./service.ts";
import { generateTeamNewsImage } from "./team-news-image.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const matchdayRoutes: FastifyPluginAsyncZod = async (app) => {
  const officialRole = requirePermission("matchday", "view");
  const adminRole = requirePermission("matchday", "manage");

  // ── Existing routes ──

  const list = listMatches(app.db);
  const get = getMatch(app.db);
  const getPublic = getMatchPublic(app.db);
  const getNewsData = getTeamNewsData(app.db);
  const record = recordExpense(app.db, app.s3);
  const update = updateExpense(app.db);
  const remove = deleteExpense(app.db);

  app.get(
    "/matchday",
    {
      preHandler: [officialRole],
      schema: {
        querystring: listMatchesSchema,
        response: { 200: listMatchesResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await list(user.id, role, request.query);
    },
  );

  app.get(
    "/matchday/:matchId",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        response: { 200: getMatchResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await get(user.id, role, request.params.matchId);
    },
  );

  /**
   * Reduced-shape team sheet for any signed-in member. Returns just the
   * squad / captain / keeper / result — no expenses, no charge IDs, no
   * audit columns. The official-gated /matchday/:matchId stays as the
   * source of truth for write operations and admin views.
   *
   * Auth: signed-in only. Privacy is weak today (team news image is
   * posted publicly anyway, per PLAN §5.7); tighten later if we want
   * "only members named in the squad can see it".
   */
  app.get(
    "/matchday/:matchId/public",
    {
      preHandler: [requireAuth],
      schema: {
        params: matchIdParamSchema,
        response: { 200: publicMatchdayResponseSchema },
      },
    },
    async (request) => {
      return await getPublic(request.params.matchId);
    },
  );

  // ── Team news image ──

  app.get(
    "/matchday/:matchId/team-news-image",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        querystring: teamNewsImageQuerySchema,
      },
    },
    async (request, reply) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const data = await getNewsData(
        user.id,
        role,
        request.params.matchId,
        request.query.isHome,
        request.query.matchTime,
      );

      if (data.players.length === 0) {
        throw Object.assign(new Error("No players selected yet"), {
          statusCode: 400,
        });
      }

      const image = await generateTeamNewsImage(data, request.log);

      return await reply
        .header("Content-Type", "image/png")
        .header(
          "Content-Disposition",
          `attachment; filename="team-news-${request.params.matchId}.png"`,
        )
        .send(image);
    },
  );

  app.post(
    "/matchday/:matchId/expenses",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        body: recordExpenseSchema,
        response: { 200: recordExpenseResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await record(user.id, role, {
        ...request.body,
        matchId: request.params.matchId,
      });
    },
  );

  app.put(
    "/matchday/expenses/:expenseId",
    {
      preHandler: [officialRole],
      schema: {
        params: expenseIdParamSchema,
        body: updateExpenseSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await update(user.id, role, {
        ...request.body,
        expenseId: request.params.expenseId,
      });
    },
  );

  app.delete(
    "/matchday/expenses/:expenseId",
    {
      preHandler: [officialRole],
      schema: {
        params: expenseIdParamSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await remove(user.id, role, request.params.expenseId);
    },
  );

  // ── Expense approval workflow routes ──

  const submit = submitExpenseClaim(app.db, app.s3);
  const approve = approveExpense(app.db);
  const reject = rejectExpense(app.db);
  const reimburse = markExpenseReimbursed(app.db);
  const pending = listPendingExpenses(app.db);

  // Static route must be registered before parameterised :expenseId routes
  app.get(
    "/matchday/expenses/pending",
    {
      preHandler: [adminRole],
      schema: {
        querystring: listPendingExpensesSchema,
        response: { 200: listPendingExpensesResponseSchema },
      },
    },
    async (request) => {
      return await pending(request.query);
    },
  );

  app.post(
    "/matchday/:matchId/expenses/submit",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        body: submitExpenseSchema,
        response: { 200: submitExpenseResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await submit(user.id, role, {
        ...request.body,
        matchId: request.params.matchId,
      });
    },
  );

  app.post(
    "/matchday/expenses/:expenseId/approve",
    {
      preHandler: [adminRole],
      schema: {
        params: expenseIdParamSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await approve(user.id, request.params.expenseId);
    },
  );

  app.post(
    "/matchday/expenses/:expenseId/reject",
    {
      preHandler: [adminRole],
      schema: {
        params: expenseIdParamSchema,
        body: rejectExpenseSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await reject(user.id, request.params.expenseId, request.body);
    },
  );

  app.post(
    "/matchday/expenses/:expenseId/reimburse",
    {
      preHandler: [adminRole],
      schema: {
        params: expenseIdParamSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await reimburse(user.id, request.params.expenseId);
    },
  );

  // ── Official panel routes ──

  const teams = listTeams(app.db);
  const create = createMatchday(app.db);
  const pastUnfinished = getPastUnfinishedMatchdays(app.db);
  const allPastUnfinished = getAllPastUnfinishedMatchdays(app.db);
  const search = searchMembers(app.db);
  const add = addPlayer(app.db);
  const removeP = removePlayer(app.db);
  const setRoles = setMatchRoles(app.db);
  const paid = markFeePaid(app.db);
  const finish = finishMatch(app.db, app.send, app.config);
  const cancel = cancelMatchday(app.db);

  // Play-Cricket API client for upcoming matches — wired at registration time
  const upcoming =
    app.config.PLAY_CRICKET_API_TOKEN && app.config.PLAY_CRICKET_SITE_ID
      ? getUpcomingMatches(
          app.db,
          createApiClient({
            apiToken: app.config.PLAY_CRICKET_API_TOKEN,
            siteId: app.config.PLAY_CRICKET_SITE_ID,
          }),
          app.config.PLAY_CRICKET_SITE_ID,
        )
      : null;

  app.get(
    "/matchday/teams",
    {
      preHandler: [officialRole],
      schema: {
        response: { 200: listTeamsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await teams(user.id, role);
    },
  );

  app.get(
    "/matchday/past-unfinished",
    {
      preHandler: [officialRole],
      schema: {
        response: { 200: allPastUnfinishedMatchdaysResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await allPastUnfinished(user.id, role);
    },
  );

  app.get(
    "/matchday/teams/:teamId/past-unfinished",
    {
      preHandler: [officialRole],
      schema: {
        params: teamIdParamSchema,
        response: { 200: pastUnfinishedMatchdaysResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await pastUnfinished(user.id, role, request.params.teamId);
    },
  );

  app.get(
    "/matchday/teams/:teamId/upcoming",
    {
      preHandler: [officialRole],
      schema: {
        params: teamIdParamSchema,
        response: { 200: upcomingMatchesResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";

      if (!upcoming) return [];
      return await upcoming(user.id, role, request.params.teamId);
    },
  );

  app.post(
    "/matchday",
    {
      preHandler: [officialRole],
      schema: {
        body: createMatchdaySchema,
        response: { 200: createMatchdayResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await create(user.id, role, request.body);
    },
  );

  app.get(
    "/matchday/members/search",
    {
      preHandler: [officialRole],
      schema: {
        querystring: searchMembersSchema,
        response: { 200: searchMembersResponseSchema },
      },
    },
    async (request) => {
      return await search(request.query);
    },
  );

  app.post(
    "/matchday/:matchId/players",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        body: addPlayerSchema,
        response: { 200: addPlayerResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await add(user.id, role, request.params.matchId, request.body);
    },
  );

  app.delete(
    "/matchday/:matchId/players/:playerId",
    {
      preHandler: [officialRole],
      schema: {
        params: playerIdParamSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await removeP(
        user.id,
        role,
        request.params.matchId,
        request.params.playerId,
      );
    },
  );

  app.put(
    "/matchday/:matchId/roles",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        body: setRolesSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await setRoles(
        user.id,
        role,
        request.params.matchId,
        request.body,
      );
    },
  );

  app.post(
    "/matchday/:matchId/players/:playerId/mark-paid",
    {
      preHandler: [officialRole],
      schema: {
        params: playerIdParamSchema,
        body: markPaidSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await paid(
        user.id,
        role,
        request.params.matchId,
        request.params.playerId,
        request.body,
      );
    },
  );

  app.post(
    "/matchday/:matchId/finish",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        body: finishMatchSchema,
        response: { 200: finishMatchResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await finish(
        user.id,
        role,
        request.params.matchId,
        request.body,
        request.log,
      );
    },
  );

  app.post(
    "/matchday/:matchId/cancel",
    {
      preHandler: [officialRole],
      schema: {
        params: matchIdParamSchema,
        body: cancelMatchdaySchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await cancel(user.id, role, request.params.matchId, request.body);
    },
  );
};
