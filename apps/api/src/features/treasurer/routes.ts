import type { FastifyPluginAsync } from "fastify";
import { parseQuery } from "../../lib/validation.ts";
import { requireRole } from "../auth/middleware.ts";
import { dateRangeSchema, paginatedDateRangeSchema } from "./schemas.ts";
import {
  getExpensesWithReceipts,
  getIncomeByMonth,
  getMatchdayExpensesSummary,
  getMembershipSummary,
  getOutstandingPayments,
  getSponsorshipSummary,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const treasurerRoutes: FastifyPluginAsync = async (app) => {
  const income = getIncomeByMonth(app.db);
  const membership = getMembershipSummary(app.db);
  const outstanding = getOutstandingPayments(app.db);
  const sponsorship = getSponsorshipSummary(app.db);
  const matchdayExpenses = getMatchdayExpensesSummary(app.db);
  const receipts = getExpensesWithReceipts(app.db);

  app.get(
    "/treasurer/income-by-month",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return await income(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/membership-summary",
    { preHandler: [requireRole("admin")] },
    async () => {
      return await membership();
    },
  );

  app.get(
    "/treasurer/outstanding-payments",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { page, pageSize } = parseQuery(request, paginatedDateRangeSchema);
      return await outstanding(page, pageSize);
    },
  );

  app.get(
    "/treasurer/sponsorship-summary",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return await sponsorship(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/matchday-expenses-summary",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return await matchdayExpenses(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/expenses-with-receipts",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return await receipts(dateFrom, dateTo);
    },
  );
};
