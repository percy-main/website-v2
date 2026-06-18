import {
  expenseReceiptRequired,
  expenseStatusSchema,
} from "@percy-main/shared";
import { z } from "zod";

const successResponseSchema = z.object({ success: z.boolean() });
const idResponseSchema = z.object({ id: z.string() });

// --- Member-facing (submitter) ------------------------------------------

export const submitExpenseSchema = z
  .object({
    description: z.string().min(1).max(500),
    amountPence: z.number().int().positive(),
    // Receipt image as a base64 data URL (data:image/...;base64,...), matching
    // the matchday receipt-upload convention. Mandatory over GBP 10.
    receiptImage: z.string().nullable().optional(),
    // Tag names the claimant proposes; existing ones are reused, new ones are
    // created. The approver can edit the final set at decision time.
    tagNames: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  })
  .refine((d) => !expenseReceiptRequired(d.amountPence) || !!d.receiptImage, {
    message: "A receipt is required for claims over GBP 10",
    path: ["receiptImage"],
  });
export type SubmitExpense = z.infer<typeof submitExpenseSchema>;

// --- Params --------------------------------------------------------------

export const expenseIdParamSchema = z.object({ expenseId: z.string().min(1) });
export type ExpenseIdParam = z.infer<typeof expenseIdParamSchema>;

export const categoryIdParamSchema = z.object({
  categoryId: z.string().min(1),
});
export type CategoryIdParam = z.infer<typeof categoryIdParamSchema>;

// --- Approver / admin actions -------------------------------------------

export const decideExpenseSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  note: z.string().max(2000).nullable().optional(),
  // Final tag set; when omitted the existing tags are kept. At least one tag
  // is required to approve (enforced in the service).
  tagNames: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
});
export type DecideExpense = z.infer<typeof decideExpenseSchema>;

export const markPaidExpenseSchema = z.object({
  note: z.string().max(500).nullable().optional(),
});
export type MarkPaidExpense = z.infer<typeof markPaidExpenseSchema>;

// --- Tag vocabulary ------------------------------------------------------

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CreateCategory = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    archived: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.archived !== undefined, {
    message: "Provide a new name or an archived flag",
  });
export type UpdateCategory = z.infer<typeof updateCategorySchema>;

// --- Queries -------------------------------------------------------------

export const listExpensesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.union([expenseStatusSchema, z.literal("all")]).default("all"),
  tagId: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
export type ListExpenses = z.infer<typeof listExpensesSchema>;

export const summaryQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

// --- Response schemas ----------------------------------------------------

const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const expenseRowSchema = z.object({
  id: z.string(),
  claimantUserId: z.string(),
  claimantName: z.string(),
  description: z.string(),
  amountPence: z.number(),
  currency: z.string(),
  status: expenseStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  decidedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  approvalCount: z.number(),
  needsTwoApprovers: z.boolean(),
  hasReceipt: z.boolean(),
  tags: z.array(tagSchema),
});

export const listExpensesResponseSchema = z.object({
  items: z.array(expenseRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const myExpensesResponseSchema = z.object({
  items: z.array(expenseRowSchema),
});

const approvalSchema = z.object({
  id: z.string(),
  approverUserId: z.string(),
  approverName: z.string().nullable(),
  decision: z.enum(["approved", "denied"]),
  note: z.string().nullable(),
  createdAt: z.string(),
});

const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  note: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

export const expenseDetailResponseSchema = z.object({
  expense: z.object({
    id: z.string(),
    claimantUserId: z.string(),
    claimantName: z.string(),
    claimantEmail: z.string().nullable(),
    description: z.string(),
    amountPence: z.number(),
    currency: z.string(),
    status: expenseStatusSchema,
    receiptImageUrl: z.string().nullable(),
    payoutFailureReason: z.string().nullable(),
    stripeOutboundPaymentId: z.string().nullable(),
    needsTwoApprovers: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    paidAt: z.string().nullable(),
  }),
  tags: z.array(tagSchema),
  approvals: z.array(approvalSchema),
  events: z.array(eventSchema),
});

export const categoriesResponseSchema = z.object({
  categories: z.array(tagSchema),
});

const statusBucketSchema = z.object({
  count: z.number(),
  totalPence: z.number(),
});

export const summaryResponseSchema = z.object({
  byStatus: z.object({
    pending: statusBucketSchema,
    awaiting_second_approval: statusBucketSchema,
    approved: statusBucketSchema,
    denied: statusBucketSchema,
    paid: statusBucketSchema,
    payout_failed: statusBucketSchema,
  }),
  byTag: z.array(
    z.object({
      tagId: z.string(),
      tagName: z.string(),
      count: z.number(),
      totalPence: z.number(),
    }),
  ),
  totals: statusBucketSchema,
});

export const submitExpenseResponseSchema = idResponseSchema;
export const decideExpenseResponseSchema = z.object({
  status: expenseStatusSchema,
});
export const markPaidExpenseResponseSchema = successResponseSchema;
export const payoutExpenseResponseSchema = z.object({
  status: expenseStatusSchema,
  stripeOutboundPaymentId: z.string().nullable(),
});
export const createCategoryResponseSchema = tagSchema;
export const updateCategoryResponseSchema = successResponseSchema;
