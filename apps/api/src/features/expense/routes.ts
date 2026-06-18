import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  getAuthSession,
  requireAnyPermission,
  requirePermission,
} from "../auth/middleware.ts";
import { createPayoutsClient, mapOutboundPaymentEvent } from "./payouts.ts";
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
  payoutExpenseResponseSchema,
  submitExpenseResponseSchema,
  submitExpenseSchema,
  summaryQuerySchema,
  summaryResponseSchema,
  updateCategoryResponseSchema,
  updateCategorySchema,
} from "./schemas.ts";
import {
  applyPayoutWebhook,
  createCategory,
  decideExpense,
  getExpenseDetail,
  getExpenseSummary,
  getMyExpenses,
  listCategories,
  listExpenses,
  markExpensePaid,
  payoutExpense,
  submitExpense,
  updateCategory,
} from "./service.ts";

/** Pull the OutboundPayment id from a v2 thin event without unsafe casts. */
function outboundPaymentIdFromEvent(event: unknown): string | null {
  if (event && typeof event === "object") {
    const e = event as {
      data?: { object?: { id?: unknown } };
      related_object?: { id?: unknown };
    };
    const fromData = e.data?.object?.id;
    if (typeof fromData === "string") return fromData;
    const fromRelated = e.related_object?.id;
    if (typeof fromRelated === "string") return fromRelated;
  }
  return null;
}

export const expenseRoutes: FastifyPluginAsyncZod = async (app) => {
  const notifyDeps = { send: app.send, baseUrl: app.config.BASE_URL };

  const payoutsClient = createPayoutsClient({
    stripeSecretKey: app.config.STRIPE_SECRET_KEY,
    financialAccountId: app.config.STRIPE_FINANCIAL_ACCOUNT_ID,
    apiVersion: app.config.STRIPE_PAYOUTS_API_VERSION,
    webhookSecret: app.config.STRIPE_PAYOUTS_WEBHOOK_SECRET,
  });

  const submit = submitExpense(app.db, { ...notifyDeps, s3: app.s3 });
  const myExpenses = getMyExpenses(app.db);
  const list = listExpenses(app.db);
  const detail = getExpenseDetail(app.db);
  const decide = decideExpense(app.db, notifyDeps);
  const markPaid = markExpensePaid(app.db, notifyDeps);
  const payout = payoutExpense(app.db, {
    ...notifyDeps,
    client: payoutsClient,
  });
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

  app.post(
    "/expenses/:expenseId/payout",
    {
      preHandler: [requirePermission("expenses", "pay")],
      schema: {
        params: expenseIdParamSchema,
        response: { 200: payoutExpenseResponseSchema },
      },
    },
    async (request) => {
      const session = getAuthSession(request);
      return await payout(
        session.user.id,
        request.params.expenseId,
        request.log,
      );
    },
  );

  // Stripe Global Payouts (v2) webhook for OutboundPayment status. v2 thin
  // events need the raw body for signature verification, so this lives in an
  // encapsulated sub-plugin with its own buffer content-type parser - exactly
  // like the v1 payments webhook, but kept separate (different signing secret
  // and event shape).
  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugin callback must be async
  await app.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );

    const onWebhook = applyPayoutWebhook(app.db);

    webhookScope.post(
      "/stripe/payouts-webhook",
      {
        schema: {
          response: {
            200: z.object({ received: z.boolean() }),
            400: z.object({ error: z.string() }),
          },
        },
      },
      async (request, reply) => {
        const signature = request.headers["stripe-signature"];
        if (!payoutsClient || typeof signature !== "string") {
          return reply.status(400).send({ error: "Bad webhook request" });
        }
        let event;
        try {
          event = payoutsClient.parseWebhookEvent(
            request.body as Buffer,
            signature,
          );
        } catch (err) {
          request.log.error({ err }, "expense_payout_webhook_bad_signature");
          return reply.status(400).send({ error: "Invalid signature" });
        }

        const outcome = mapOutboundPaymentEvent(event.type);
        if (outcome) {
          const id = outboundPaymentIdFromEvent(event);
          if (id) await onWebhook(id, outcome, request.log);
        }
        return reply.status(200).send({ received: true });
      },
    );
  });
};
