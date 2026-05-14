import { z } from "zod";

export const dateRangeSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const paginatedDateRangeSchema = dateRangeSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type DateRange = z.infer<typeof dateRangeSchema>;
export type PaginatedDateRange = z.infer<typeof paginatedDateRangeSchema>;

// Response schemas

export const incomeByMonthResponseSchema = z.object({
  charges: z.array(
    z.object({
      month: z.string(),
      type: z.string(),
      total_pence: z.number(),
    }),
  ),
  gameSponsorIncome: z.array(
    z.object({
      month: z.string(),
      total_pence: z.number(),
    }),
  ),
  playerSponsorIncome: z.array(
    z.object({
      month: z.string(),
      total_pence: z.number(),
    }),
  ),
});

export const membershipSummaryResponseSchema = z.object({
  memberships: z.array(
    z.object({
      type: z.string().nullable(),
      total: z.number(),
      active: z.number(),
      lapsed: z.number(),
    }),
  ),
});

export const outstandingPaymentsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      amount_pence: z.number(),
      charge_date: z.string(),
      description: z.string(),
      member_name: z.string().nullable(),
      member_email: z.string().nullable(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const sponsorshipSummaryResponseSchema = z.object({
  gameSponsorship: z.object({
    total: z.number(),
    approved_paid: z.number(),
    pending_payment: z.number(),
    pending_approval: z.number(),
    total_amount_pence: z.number(),
  }),
  playerSponsorship: z.object({
    total: z.number(),
    approved_paid: z.number(),
    pending_payment: z.number(),
    pending_approval: z.number(),
    total_amount_pence: z.number(),
  }),
});

export const matchdayExpensesSummaryResponseSchema = z.object({
  breakdown: z.array(
    z.object({
      expense_type: z.string(),
      count: z.number(),
      total_pence: z.number(),
    }),
  ),
  grandTotal: z.number(),
});

export const expensesWithReceiptsResponseSchema = z.object({
  expenses: z.array(
    z.object({
      id: z.string(),
      expense_type: z.string(),
      description: z.string().nullable(),
      amount_pence: z.number(),
      receipt_image_url: z.string().nullable(),
      created_at: z.string(),
      status: z.string(),
      submitted_at: z.string().nullable(),
      approved_at: z.string().nullable(),
      rejected_reason: z.string().nullable(),
      reimbursed_at: z.string().nullable(),
      match_date: z.string(),
      opposition: z.string(),
      submitted_by_name: z.string(),
    }),
  ),
});

// --- Expense History (issue #78) ---

const EXPENSE_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "reimbursed",
] as const;

const expenseStatusCsvSchema = z
  .string()
  .refine(
    (val) =>
      val
        .split(",")
        .every((s) =>
          EXPENSE_STATUSES.includes(s as (typeof EXPENSE_STATUSES)[number]),
        ),
    {
      message:
        "Invalid status value. Allowed: draft, submitted, approved, rejected, reimbursed",
    },
  )
  .optional();

export const expenseHistoryFiltersSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: expenseStatusCsvSchema,
  expenseType: z.string().optional(),
  search: z.string().optional(),
  teamId: z.string().optional(),
});

export type ExpenseHistoryFilters = z.infer<typeof expenseHistoryFiltersSchema>;

export const expenseHistoryQuerySchema = expenseHistoryFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ExpenseHistoryQuery = z.infer<typeof expenseHistoryQuerySchema>;

const expenseHistoryItemSchema = z.object({
  id: z.string(),
  expense_type: z.string(),
  description: z.string().nullable(),
  amount_pence: z.number(),
  receipt_image_url: z.string().nullable(),
  created_at: z.string(),
  status: z.string(),
  submitted_at: z.string().nullable(),
  approved_at: z.string().nullable(),
  approved_by_name: z.string().nullable(),
  rejected_reason: z.string().nullable(),
  reimbursed_at: z.string().nullable(),
  reimbursed_by_name: z.string().nullable(),
  match_date: z.string(),
  opposition: z.string(),
  team_name: z.string(),
  submitted_by_name: z.string(),
});

export const expenseHistoryResponseSchema = z.object({
  items: z.array(expenseHistoryItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const csvExportResponseSchema = z.string().describe("CSV file content");
