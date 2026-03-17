import type { FastifyPluginAsync } from "fastify";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.js";
import { getAuthSession, requireRole } from "../auth/middleware.js";
import { createApiClient } from "../play-cricket/api-client.js";
import {
  addPlayerSchema,
  confirmTeamSchema,
  createMatchdaySchema,
  expenseIdParamSchema,
  listMatchesSchema,
  markPaidSchema,
  matchIdParamSchema,
  playerIdParamSchema,
  recordExpenseSchema,
  searchMembersSchema,
  teamIdParamSchema,
  updateExpenseSchema,
} from "./schemas.js";
import {
  addPlayer,
  confirmTeam,
  createMatchday,
  deleteExpense,
  finishMatch,
  getMatch,
  getUpcomingMatches,
  listMatches,
  listTeams,
  markFeePaid,
  recordExpense,
  removePlayer,
  searchMembers,
  updateExpense,
} from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const matchdayRoutes: FastifyPluginAsync = async (app) => {
  const officialRole = requireRole("official", "admin");

  // ── Existing routes ──

  const list = listMatches(app.db);
  const get = getMatch(app.db);
  const record = recordExpense(app.db);
  const update = updateExpense(app.db);
  const remove = deleteExpense(app.db);

  app.get("/matchday", { preHandler: [officialRole] }, async (request) => {
    const { user } = getAuthSession(request);
    const role = (user as { role?: string | null }).role ?? "user";
    const params = parseQuery(request, listMatchesSchema);
    return await list(user.id, role, params);
  });

  app.get(
    "/matchday/:matchId",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { matchId } = parseParams(request, matchIdParamSchema);
      return await get(user.id, role, matchId);
    },
  );

  app.post(
    "/matchday/:matchId/expenses",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { matchId } = parseParams(request, matchIdParamSchema);
      const data = parseBody(request, recordExpenseSchema);
      return await record(user.id, role, { ...data, matchId });
    },
  );

  app.put(
    "/matchday/expenses/:expenseId",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { expenseId } = parseParams(request, expenseIdParamSchema);
      const data = parseBody(request, updateExpenseSchema);
      return await update(user.id, role, { ...data, expenseId });
    },
  );

  app.delete(
    "/matchday/expenses/:expenseId",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { expenseId } = parseParams(request, expenseIdParamSchema);
      return await remove(user.id, role, expenseId);
    },
  );

  // ── Official panel routes ──

  const teams = listTeams(app.db);
  const create = createMatchday(app.db);
  const search = searchMembers(app.db);
  const add = addPlayer(app.db);
  const removeP = removePlayer(app.db);
  const confirm = confirmTeam(app.db);
  const paid = markFeePaid(app.db);
  const finish = finishMatch(app.db, app.send, app.config);

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
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      return await teams(user.id, role);
    },
  );

  app.get(
    "/matchday/teams/:teamId/upcoming",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { teamId } = parseParams(request, teamIdParamSchema);

      if (!upcoming) return [];
      return await upcoming(user.id, role, teamId);
    },
  );

  app.post("/matchday", { preHandler: [officialRole] }, async (request) => {
    const { user } = getAuthSession(request);
    const role = (user as { role?: string | null }).role ?? "user";
    const data = parseBody(request, createMatchdaySchema);
    return await create(user.id, role, data);
  });

  app.get(
    "/matchday/members/search",
    { preHandler: [officialRole] },
    async (request) => {
      const params = parseQuery(request, searchMembersSchema);
      return await search(params);
    },
  );

  app.post(
    "/matchday/:matchId/players",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { matchId } = parseParams(request, matchIdParamSchema);
      const data = parseBody(request, addPlayerSchema);
      return await add(user.id, role, matchId, data);
    },
  );

  app.delete(
    "/matchday/:matchId/players/:playerId",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { matchId, playerId } = parseParams(request, playerIdParamSchema);
      return await removeP(user.id, role, matchId, playerId);
    },
  );

  app.post(
    "/matchday/:matchId/confirm",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { matchId } = parseParams(request, matchIdParamSchema);
      const data = parseBody(request, confirmTeamSchema);
      return await confirm(user.id, role, matchId, data);
    },
  );

  app.post(
    "/matchday/:matchId/players/:playerId/mark-paid",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { matchId, playerId } = parseParams(request, playerIdParamSchema);
      const data = parseBody(request, markPaidSchema);
      return await paid(user.id, role, matchId, playerId, data);
    },
  );

  app.post(
    "/matchday/:matchId/finish",
    { preHandler: [officialRole] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role = (user as { role?: string | null }).role ?? "user";
      const { matchId } = parseParams(request, matchIdParamSchema);
      return await finish(user.id, role, matchId);
    },
  );
};
