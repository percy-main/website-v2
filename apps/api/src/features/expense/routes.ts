import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  getAuthSession,
  requireAnyPermission,
  requirePermission,
} from "../auth/middleware.ts";
import {
  categoriesResponseSchema,
  categoryIdParamSchema,
  createCategoryResponseSchema,
  createCategorySchema,
  decideExpenseResponseSchema,
  decideExpenseSchema,
  expenseDetailResponseSchema,
  expenseIdParamSchema,
  listExpensesResponseSchema,
  listExpensesSchema,
  markPaidExpenseResponseSchema,
  markPaidExpenseSchema,
  myExpensesResponseSchema,
  submitExpenseResponseSchema,
  submitExpenseSchema,
  summaryQuerySchema,
  summaryResponseSchema,
  updateCategoryResponseSchema,
  updateCategorySchema,
} from "./schemas.ts";
import {
  createCategory,
  decideExpense,
  getExpenseDetail,
  getExpenseSummary,
  getMyExpenses,
  listCategories,
  listExpenses,
  markExpensePaid,
  submitExpense,
  updateCategory,
} from "./service.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const expenseRoutes: FastifyPluginAsyncZod = async (app) => {
  const notifyDeps = { send: app.send, baseUrl: app.config.BASE_URL };

  const submit = submitExpense(app.db, { ...notifyDeps, s3: app.s3 });
  const myExpenses = getMyExpenses(app.db);
  const list = listExpenses(app.db);
  const detail = getExpenseDetail(app.db);
  const decide = decideExpense(app.db, notifyDeps);
  const markPaid = markExpensePaid(app.db, notifyDeps);
  const summary = getExpenseSummary(app.db);
  const categories = listCategories(app.db);
  const addCategory = createCategory(app.db);
  const editCategory = updateCategory(app.db);

  // --- Submitter-facing ---

  app.post(
    "/expenses",
    {
      preHandler: [requirePermission("expenses", "submit")],
      schema: {
        body: submitExpenseSchema,
        response: { 200: submitExpenseResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await submit(
        session.user.id,
        session.user.name,
        request.body,
        request.log,
      );
    },
  );

  app.get(
    "/expenses/mine",
    {
      preHandler: [requirePermission("expenses", "view_own")],
      schema: { response: { 200: myExpensesResponseSchema } },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await myExpenses(session.user.id);
    },
  );

  // --- Tag vocabulary (shared by submit form + admin) ---

  app.get(
    "/expense-categories",
    {
      preHandler: [
        requireAnyPermission(
          { resource: "expenses", action: "submit" },
          { resource: "expenses", action: "view" },
        ),
      ],
      schema: { response: { 200: categoriesResponseSchema } },
    },
    async () => {
      return await categories(false);
    },
  );

  app.post(
    "/expense-categories",
    {
      preHandler: [
        requireAnyPermission(
          { resource: "expenses", action: "submit" },
          { resource: "expenses", action: "approve" },
        ),
      ],
      schema: {
        body: createCategorySchema,
        response: { 200: createCategoryResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await addCategory(session.user.id, request.body);
    },
  );

  app.patch(
    "/expense-categories/:categoryId",
    {
      preHandler: [requirePermission("expenses", "manage_tags")],
      schema: {
        params: categoryIdParamSchema,
        body: updateCategorySchema,
        response: { 200: updateCategoryResponseSchema },
      },
    },
    async (request) => {
      return await editCategory(request.params.categoryId, request.body);
    },
  );

  // --- Approver / finance admin ---

  app.get(
    "/expenses",
    {
      preHandler: [requirePermission("expenses", "view")],
      schema: {
        querystring: listExpensesSchema,
        response: { 200: listExpensesResponseSchema },
      },
    },
    async (request) => {
      return await list(request.query);
    },
  );

  app.get(
    "/expenses/summary",
    {
      preHandler: [requirePermission("expenses", "view")],
      schema: {
        querystring: summaryQuerySchema,
        response: { 200: summaryResponseSchema },
      },
    },
    async (request) => {
      return await summary(request.query);
    },
  );

  app.get(
    "/expenses/:expenseId",
    {
      preHandler: [requirePermission("expenses", "view")],
      schema: {
        params: expenseIdParamSchema,
        response: { 200: expenseDetailResponseSchema },
      },
    },
    async (request) => {
      return await detail(request.params.expenseId);
    },
  );

  app.post(
    "/expenses/:expenseId/decision",
    {
      preHandler: [requirePermission("expenses", "approve")],
      schema: {
        params: expenseIdParamSchema,
        body: decideExpenseSchema,
        response: { 200: decideExpenseResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await decide(
        session.user.id,
        request.params.expenseId,
        request.body,
        request.log,
      );
    },
  );

  app.post(
    "/expenses/:expenseId/mark-paid",
    {
      preHandler: [requirePermission("expenses", "pay")],
      schema: {
        params: expenseIdParamSchema,
        body: markPaidExpenseSchema,
        response: { 200: markPaidExpenseResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await markPaid(
        session.user.id,
        request.params.expenseId,
        request.body,
        request.log,
      );
    },
  );
};
