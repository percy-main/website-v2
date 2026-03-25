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

// ── Result confirmation schemas ──

export const resultTypeSchema = z.enum(["W", "L", "D", "T", "A", "C", "N"]);

export const finishMatchSchema = z.object({
  resultType: resultTypeSchema,
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

// ── Response schemas ──

const matchdayItemSchema = z.object({
  id: z.string(),
  play_cricket_team_id: z.string(),
  match_date: z.string(),
  opposition: z.string(),
  competition_type: z.string().nullable(),
  play_cricket_match_id: z.string().nullable(),
  status: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  confirmed_at: z.string().nullable(),
  confirmed_by: z.string().nullable(),
  finished_at: z.string().nullable(),
  finished_by: z.string().nullable(),
  result_type: z.string().nullable(),
  result_confirmed_at: z.string().nullable(),
  result_confirmed_by: z.string().nullable(),
  result_source: z.string().nullable(),
});

export const listMatchesResponseSchema = z.object({
  items: z.array(matchdayItemSchema),
});

const matchdayPlayerSchema = z.object({
  id: z.string(),
  member_id: z.string().nullable(),
  player_name: z.string(),
  status: z.string(),
  replaced_by_matchday_player_id: z.string().nullable(),
  charge_id: z.string().nullable(),
  created_at: z.string(),
  member_category: z.string().nullable(),
  chargePaidAt: z.string().nullable(),
});

const matchdayExpenseSchema = z.object({
  id: z.string(),
  matchday_id: z.string(),
  expense_type: z.string(),
  description: z.string().nullable(),
  amount_pence: z.number(),
  created_by: z.string(),
  created_at: z.string(),
  receipt_image_url: z.string().nullable(),
  status: z.string(),
  submitted_at: z.string().nullable(),
  approved_at: z.string().nullable(),
  approved_by: z.string().nullable(),
  reimbursed_at: z.string().nullable(),
  reimbursed_by: z.string().nullable(),
  rejected_reason: z.string().nullable(),
});

export const getMatchResponseSchema = z.object({
  matchday: matchdayItemSchema,
  team: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
    })
    .nullable(),
  players: z.array(matchdayPlayerSchema),
  expenses: z.array(matchdayExpenseSchema),
});

export const recordExpenseResponseSchema = z.object({
  expenseId: z.string(),
});

export const successResponseSchema = z.object({
  success: z.boolean(),
});

export const listPendingExpensesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      matchday_id: z.string(),
      expense_type: z.string(),
      description: z.string().nullable(),
      amount_pence: z.number(),
      receipt_image_url: z.string().nullable(),
      status: z.string(),
      created_at: z.string(),
      submitted_at: z.string().nullable(),
      approved_at: z.string().nullable(),
      rejected_reason: z.string().nullable(),
      opposition: z.string(),
      match_date: z.string(),
      play_cricket_team_id: z.string(),
      created_by_name: z.string().nullable(),
    }),
  ),
});

export const submitExpenseResponseSchema = z.object({
  expenseId: z.string(),
});

const teamSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  is_junior: z.boolean(),
});

export const listTeamsResponseSchema = z.array(teamSchema);

const upcomingMatchSchema = z.object({
  matchId: z.string(),
  matchDate: z.string(),
  matchTime: z.string().nullable(),
  opposition: z.string(),
  isHome: z.boolean(),
  competitionName: z.string().nullable(),
  competitionType: z.string().nullable(),
  matchdayId: z.string().nullable(),
  matchdayStatus: z.string().nullable(),
});

export const upcomingMatchesResponseSchema = z.array(upcomingMatchSchema);

export const createMatchdayResponseSchema = z.object({
  id: z.string(),
});

const searchMemberItemSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  member_category: z.string().nullable(),
});

export const searchMembersResponseSchema = z.array(searchMemberItemSchema);

export const addPlayerResponseSchema = z.object({
  id: z.string(),
});

export const finishMatchResponseSchema = z.object({
  success: z.boolean(),
  emailsSent: z.number(),
  emailErrors: z.array(z.string()),
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
export type FinishMatch = z.infer<typeof finishMatchSchema>;
