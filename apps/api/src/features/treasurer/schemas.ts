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
      member_email: z.string(),
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
