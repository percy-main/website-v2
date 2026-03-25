import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireRole } from "../auth/middleware.ts";
import {
  dateRangeSchema,
  expensesWithReceiptsResponseSchema,
  incomeByMonthResponseSchema,
  matchdayExpensesSummaryResponseSchema,
  membershipSummaryResponseSchema,
  outstandingPaymentsResponseSchema,
  paginatedDateRangeSchema,
  sponsorshipSummaryResponseSchema,
} from "./schemas.ts";
import {
  getExpensesWithReceipts,
  getIncomeByMonth,
  getMatchdayExpensesSummary,
  getMembershipSummary,
  getOutstandingPayments,
  getSponsorshipSummary,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const treasurerRoutes: FastifyPluginAsyncZod = async (app) => {
  const income = getIncomeByMonth(app.db);
  const membership = getMembershipSummary(app.db);
  const outstanding = getOutstandingPayments(app.db);
  const sponsorship = getSponsorshipSummary(app.db);
  const matchdayExpenses = getMatchdayExpensesSummary(app.db);
  const receipts = getExpensesWithReceipts(app.db);

  app.get(
    "/treasurer/income-by-month",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: dateRangeSchema,
        response: { 200: incomeByMonthResponseSchema },
      },
    },
    async (request) => {
      const { dateFrom, dateTo } = request.query;
      return await income(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/membership-summary",
    {
      preHandler: [requireRole("admin")],
      schema: {
        response: { 200: membershipSummaryResponseSchema },
      },
    },
    async () => {
      return await membership();
    },
  );

  app.get(
    "/treasurer/outstanding-payments",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: paginatedDateRangeSchema,
        response: { 200: outstandingPaymentsResponseSchema },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query;
      return await outstanding(page, pageSize);
    },
  );

  app.get(
    "/treasurer/sponsorship-summary",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: dateRangeSchema,
        response: { 200: sponsorshipSummaryResponseSchema },
      },
    },
    async (request) => {
      const { dateFrom, dateTo } = request.query;
      return await sponsorship(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/matchday-expenses-summary",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: dateRangeSchema,
        response: { 200: matchdayExpensesSummaryResponseSchema },
      },
    },
    async (request) => {
      const { dateFrom, dateTo } = request.query;
      return await matchdayExpenses(dateFrom, dateTo);
    },
  );

  app.get(
    "/treasurer/expenses-with-receipts",
    {
      preHandler: [requireRole("admin")],
      schema: {
        querystring: dateRangeSchema,
        response: { 200: expensesWithReceiptsResponseSchema },
      },
    },
    async (request) => {
      const { dateFrom, dateTo } = request.query;
      return await receipts(dateFrom, dateTo);
    },
  );
};
