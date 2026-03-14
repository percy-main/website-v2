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
  app.get(
    "/matchday",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const role =
        (user as { role?: string | null }).role ?? "user";
      const params = parseQuery(request, listMatchesSchema);
      return listMatches(user.id, role, params);
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
      return getMatch(user.id, role, matchId);
    },
  );

  app.post<{ Params: { matchId: string } }>(
    "/matchday/:matchId/expenses",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const { matchId } = request.params;
      const data = parseBody(request, recordExpenseSchema);
      return recordExpense(user.id, { ...data, matchId });
    },
  );

  app.put<{ Params: { expenseId: string } }>(
    "/matchday/expenses/:expenseId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const { expenseId } = request.params;
      const data = parseBody(request, updateExpenseSchema);
      return updateExpense(user.id, { ...data, expenseId });
    },
  );

  app.delete<{ Params: { expenseId: string } }>(
    "/matchday/expenses/:expenseId",
    { preHandler: [requireRole("official", "admin")] },
    async (request) => {
      const { user } = request.authSession!;
      const { expenseId } = request.params;
      return deleteExpense(user.id, expenseId);
    },
  );
};
