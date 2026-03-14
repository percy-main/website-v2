import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/middleware.js";
import { parseQuery } from "../../lib/validation.js";
import { dateRangeSchema, paginatedDateRangeSchema } from "./schemas.js";
import {
  getIncomeByMonth,
  getMembershipSummary,
  getOutstandingPayments,
  getSponsorshipSummary,
  getMatchdayExpensesSummary,
  getExpensesWithReceipts,
} from "./service.js";

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
      return income(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/membership-summary",
    { preHandler: [requireRole("admin")] },
    async () => {
      return membership();
    },
  );

  app.get(
    "/treasurer/outstanding-payments",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { page, pageSize } = parseQuery(
        request,
        paginatedDateRangeSchema,
      );
      return outstanding(page, pageSize);
    },
  );

  app.get(
    "/treasurer/sponsorship-summary",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return sponsorship(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/matchday-expenses-summary",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return matchdayExpenses(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/expenses-with-receipts",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return receipts(dateFrom, dateTo);
    },
  );
};
