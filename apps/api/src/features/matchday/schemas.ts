import { z } from "zod";

// ── Shared enums ──

export const expenseTypeSchema = z.enum([
  "umpire_fee",
  "scorer_fee",
  "match_ball",
  "teas",
  "miscellaneous",
]);

export const paymentMethodSchema = z.enum(["cash", "bank_transfer", "card"]);

// ── Existing schemas (matchday list / expense CRUD) ──

export const listMatchesSchema = z.object({
  teamId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  statusFilter: z
    .enum(["all", "pending", "confirmed", "finished"])
    .default("all"),
});

export const getMatchSchema = z.object({
  matchId: z.string(),
});

export const recordExpenseSchema = z.object({
  type: expenseTypeSchema,
  description: z.string().optional(),
  amountPence: z.number().int().positive(),
  receiptImage: z.string().optional(),
});

export const updateExpenseSchema = z.object({
  expenseId: z.string(),
  type: expenseTypeSchema.optional(),
  description: z.string().optional(),
  amountPence: z.number().int().positive().optional(),
});

export const deleteExpenseSchema = z.object({
  expenseId: z.string(),
});

export const matchIdParamSchema = z.object({
  matchId: z.string(),
});

export const expenseIdParamSchema = z.object({
  expenseId: z.string(),
});

// ── Official panel schemas ──

export const teamIdParamSchema = z.object({
  teamId: z.string(),
});

export const playerIdParamSchema = z.object({
  matchId: z.string(),
  playerId: z.string(),
});

export const createMatchdaySchema = z.object({
  teamId: z.string(),
  matchDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  opposition: z.string().min(1),
  competitionType: z.string().optional(),
  playCricketMatchId: z.string().optional(),
});

export const addPlayerSchema = z.object({
  memberId: z.string().optional(),
  playerName: z.string().min(1),
});

export const confirmTeamSchema = z.object({
  playerStatuses: z.array(
    z.object({
      matchdayPlayerId: z.string(),
      status: z.enum(["playing", "dropped_out", "no_show"]),
    }),
  ),
});

export const markPaidSchema = z.object({
  paymentMethod: paymentMethodSchema,
});

export const searchMembersSchema = z.object({
  query: z.string().min(1),
});

// ── Expense approval workflow schemas ──

export const expenseStatusSchema = z.enum([
  "draft",
  "submitted",
  "approved",
  "rejected",
  "reimbursed",
]);

export const submitExpenseSchema = z.object({
  type: expenseTypeSchema,
  description: z.string().optional(),
  amountPence: z.number().int().positive(),
  receiptImage: z.string().optional(),
});

export const rejectExpenseSchema = z.object({
  reason: z.string().min(1),
});

export const listPendingExpensesSchema = z.object({
  status: z.enum(["submitted", "approved"]).optional(),
  teamId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Types ──

export type ListMatches = z.infer<typeof listMatchesSchema>;
export type GetMatch = z.infer<typeof getMatchSchema>;
export type RecordExpense = z.infer<typeof recordExpenseSchema>;
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
export type DeleteExpense = z.infer<typeof deleteExpenseSchema>;
export type CreateMatchday = z.infer<typeof createMatchdaySchema>;
export type AddPlayer = z.infer<typeof addPlayerSchema>;
export type ConfirmTeam = z.infer<typeof confirmTeamSchema>;
export type MarkPaid = z.infer<typeof markPaidSchema>;
export type SearchMembers = z.infer<typeof searchMembersSchema>;
export type SubmitExpense = z.infer<typeof submitExpenseSchema>;
export type RejectExpense = z.infer<typeof rejectExpenseSchema>;
export type ListPendingExpenses = z.infer<typeof listPendingExpensesSchema>;
