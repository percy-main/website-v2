import type { FastifyPluginAsync } from "fastify";
import { requireRole, getAuthSession } from "../auth/middleware.js";
import { parseBody, parseParams, parseQuery } from "../../lib/validation.js";
import {
  listMatchesSchema,
  matchIdParamSchema,
  expenseIdParamSchema,
  recordExpenseSchema,
  updateExpenseSchema,
} from "./schemas.js";
import {
  listMatches,
  getMatch,
  recordExpense,
  updateExpense,
  deleteExpense,
} from "./service.js";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const matchdayRoutes: FastifyPluginAsync = async (app) => {
  const list = listMatches(app.db);
  const get = getMatch(app.db);
  const record = recordExpense(app.db);
  const update = updateExpense(app.db);
  const remove = deleteExpense(app.db);

  app.get(
    "/matchday",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role =
        (user as { role?: string | null }).role ?? "user";
      const params = parseQuery(request, listMatchesSchema);
      return await list(user.id, role, params);
    },
  );

  app.get(
    "/matchday/:matchId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { matchId } = parseParams(request, matchIdParamSchema);
      return await get(user.id, role, matchId);
    },
  );

  app.post(
    "/matchday/:matchId/expenses",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { matchId } = parseParams(request, matchIdParamSchema);
      const data = parseBody(request, recordExpenseSchema);
      return await record(user.id, { ...data, matchId });
    },
  );

  app.put(
    "/matchday/expenses/:expenseId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { expenseId } = parseParams(request, expenseIdParamSchema);
      const data = parseBody(request, updateExpenseSchema);
      return await update(user.id, { ...data, expenseId });
    },
  );

  app.delete(
    "/matchday/expenses/:expenseId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = getAuthSession(request);
      const { expenseId } = parseParams(request, expenseIdParamSchema);
      return await remove(user.id, expenseId);
    },
  );
};
