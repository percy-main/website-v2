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
  app.get(
    "/treasurer/income-by-month",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return getIncomeByMonth(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/membership-summary",
    { preHandler: [requireRole("admin")] },
    async () => {
      return getMembershipSummary();
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
      return getOutstandingPayments(page, pageSize);
    },
  );

  app.get(
    "/treasurer/sponsorship-summary",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return getSponsorshipSummary(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/matchday-expenses-summary",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return getMatchdayExpensesSummary(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/expenses-with-receipts",
    { preHandler: [requireRole("admin")] },
    async (request) => {
      const { dateFrom, dateTo } = parseQuery(request, dateRangeSchema);
      return getExpensesWithReceipts(dateFrom, dateTo);
    },
  );
};
