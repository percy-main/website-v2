import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/middleware.js";
import { parseBody, parseQuery } from "../../lib/validation.js";
import {
  listMatchesSchema,
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
      const { user } = request.authSession!;
      const role =
        (user as { role?: string | null }).role ?? "user";
      const params = parseQuery(request, listMatchesSchema);
      return list(user.id, role, params);
    },
  );

  app.get<{ Params: { matchId: string } }>(
    "/matchday/:matchId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const role =
        (user as { role?: string | null }).role ?? "user";
      const { matchId } = request.params;
      return get(user.id, role, matchId);
    },
  );

  app.post<{ Params: { matchId: string } }>(
    "/matchday/:matchId/expenses",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const { matchId } = request.params;
      const data = parseBody(request, recordExpenseSchema);
      return record(user.id, { ...data, matchId });
    },
  );

  app.put<{ Params: { expenseId: string } }>(
    "/matchday/expenses/:expenseId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const { expenseId } = request.params;
      const data = parseBody(request, updateExpenseSchema);
      return update(user.id, { ...data, expenseId });
    },
  );

  app.delete<{ Params: { expenseId: string } }>(
    "/matchday/expenses/:expenseId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const { expenseId } = request.params;
      return remove(user.id, expenseId);
    },
  );
};
