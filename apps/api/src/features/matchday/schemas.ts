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
    .enum(["all", "pending", "confirmed", "finished", "cancelled"])
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
  dependentId: z.string().optional(),
  playerName: z.string().min(1),
});

export const playerStatusSchema = z.object({
  matchdayPlayerId: z.string(),
  status: z.enum(["playing", "dropped_out", "no_show"]),
});

export const feeOverrideSchema = z.object({
  matchdayPlayerId: z.string(),
  amountPence: z.number().int().min(0),
});

export const setRolesSchema = z.object({
  captainPlayerId: z.string().nullable(),
  wicketkeeperPlayerId: z.string().nullable(),
});

export const markPaidSchema = z.object({
  paymentMethod: paymentMethodSchema,
});

export const searchMembersSchema = z.object({
  query: z.string().min(1),
});

// ── Team news image schemas ──

// Both are pure overrides. When absent, the route derives them from
// the joined play-cricket fixture (home_club_id / match_time).
export const teamNewsImageQuerySchema = z.object({
  isHome: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  matchTime: z.string().optional(),
});

// ── Result confirmation schemas ──

export const resultTypeSchema = z.enum(["W", "L", "D", "T", "A", "C", "N"]);

export const finishMatchSchema = z.object({
  resultType: resultTypeSchema,
  playerStatuses: z.array(playerStatusSchema).optional(),
  feeOverrides: z.array(feeOverrideSchema).optional(),
});

// ── Cancel matchday schemas ──

export const cancelMatchdaySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
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
  cancelled_at: z.string().nullable(),
  cancelled_by: z.string().nullable(),
  cancelled_reason: z.string().nullable(),
  // Null until the captain sends the donation-request batch. Lets the
  // wrap-up UI show an unpaid count and a "Send donation requests" CTA
  // before notifying, and switch to a "sent" state afterwards.
  charges_notified_at: z.string().nullable(),
  charges_notified_by: z.string().nullable(),
});

export const listMatchesResponseSchema = z.object({
  items: z.array(matchdayItemSchema),
});

const matchdayPlayerSchema = z.object({
  id: z.string(),
  member_id: z.string().nullable(),
  dependent_id: z.string().nullable(),
  player_name: z.string(),
  status: z.string(),
  replaced_by_matchday_player_id: z.string().nullable(),
  charge_id: z.string().nullable(),
  created_at: z.string(),
  member_category: z.string().nullable(),
  // `parent_name` is only set when this row points at a `dependent` —
  // it gives the captain enough context to disambiguate juniors
  // sharing a first name without pulling the whole junior record.
  parent_name: z.string().nullable(),
  chargePaidAt: z.string().nullable(),
  // Neutral, captain-facing status. Relief is reported as "waived"
  // without naming the financial-relief mechanism — the application
  // text and the grant note are never returned here.
  chargeStatus: z.enum(["unpaid", "paid", "waived"]).nullable(),
  is_captain: z.boolean(),
  is_wicketkeeper: z.boolean(),
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

/**
 * Reduced-shape team sheet visible to any signed-in member.
 * Drops everything sensitive — no expenses, no charge IDs, no
 * amounts — but keeps the squad list, captain/keeper, and result
 * so the matchday app's team-sheet view can render.
 */
export const publicMatchdayPlayerSchema = z.object({
  matchdayPlayerId: z.string(),
  memberId: z.string().nullable(),
  isCaptain: z.boolean(),
  isKeeper: z.boolean(),
  isGuest: z.boolean(),
  displayName: z.string(),
  note: z.string().nullable(),
});
export const publicMatchdayResponseSchema = z.object({
  id: z.string(),
  matchDate: z.string(),
  startTime: z.string().nullable(),
  teamName: z.string().nullable(),
  opposition: z.string().nullable(),
  ground: z.string().nullable(),
  competition: z.string().nullable(),
  // Nullable until play_cricket_match is joined into the public projection.
  // Returning a hardcoded `false` here lied to the matchday app, which
  // rendered every fixture as a home game.
  away: z.boolean().nullable(),
  // The service throws 404 for `cancelled` (free-text reason may carry
  // PII). `pending` is the live state captains pick squads into now
  // that the pre-match confirm step is gone, so it's exposed here too.
  status: z.enum(["pending", "confirmed", "finished"]),
  result: z.string().nullable(),
  scoreSummary: z.string().nullable(),
  squad: z.array(publicMatchdayPlayerSchema),
  dropouts: z.array(publicMatchdayPlayerSchema),
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

const pastUnfinishedMatchdaySchema = z.object({
  id: z.string(),
  match_date: z.string(),
  opposition: z.string(),
  status: z.string(),
  competition_type: z.string().nullable(),
});

export const pastUnfinishedMatchdaysResponseSchema = z.array(
  pastUnfinishedMatchdaySchema,
);

export const allPastUnfinishedMatchdaysResponseSchema = z.array(
  pastUnfinishedMatchdaySchema.extend({
    play_cricket_match_id: z.string().nullable(),
    team_id: z.string().nullable(),
    team_name: z.string().nullable(),
  }),
);

export const createMatchdayResponseSchema = z.object({
  id: z.string(),
  importedPlayers: z.number().int().nonnegative(),
});

const searchMemberItemSchema = z.object({
  type: z.literal("member"),
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  member_category: z.string().nullable(),
});

const searchDependentItemSchema = z.object({
  type: z.literal("dependent"),
  id: z.string(),
  name: z.string(),
  parent_name: z.string().nullable(),
});

export const searchMembersResponseSchema = z.array(
  z.union([searchMemberItemSchema, searchDependentItemSchema]),
);

export const addPlayerResponseSchema = z.object({
  id: z.string(),
});

// Wrapping up a match only creates the match-fee charges now - the
// donation-request emails/pushes go out via a separate notify step. So
// the response reports how many charges were raised, not how many
// emails were sent.
export const finishMatchResponseSchema = z.object({
  success: z.boolean(),
  chargesCreated: z.number(),
});

export const notifyChargesResponseSchema = z.object({
  success: z.boolean(),
  emailsSent: z.number(),
  emailErrors: z.array(z.string()),
});

// ── "Mine" routes — per-user home cards ──

const myUpcomingMatchSchema = z.object({
  // The matchday_player row id — the handle the dropout action uses to
  // withdraw this specific selection (the member's own, or a dependent's).
  matchdayPlayerId: z.string(),
  matchdayId: z.string(),
  matchDate: z.string(),
  opposition: z.string(),
  teamName: z.string().nullable(),
  competitionType: z.string().nullable(),
  isCaptain: z.boolean(),
  isWicketkeeper: z.boolean(),
  // The selected player's display name.
  playerName: z.string(),
  // True when this selection belongs to one of the signed-in member's
  // dependents (a parent dropping a junior out on their behalf) rather
  // than the member themselves. `dependentName` is the junior's name.
  forDependent: z.boolean(),
  dependentName: z.string().nullable(),
});

export const myUpcomingMatchesResponseSchema = z.array(myUpcomingMatchSchema);

export const matchdayPlayerIdParamSchema = z.object({
  matchdayPlayerId: z.string(),
});

export const myRecentPerformanceResponseSchema = z.object({
  windowDays: z.number().int().positive(),
  matchesPlayed: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  wickets: z.number().int().nonnegative(),
  catches: z.number().int().nonnegative(),
});

// ── Types ──

export type ListMatches = z.infer<typeof listMatchesSchema>;
export type GetMatch = z.infer<typeof getMatchSchema>;
export type RecordExpense = z.infer<typeof recordExpenseSchema>;
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
export type DeleteExpense = z.infer<typeof deleteExpenseSchema>;
export type CreateMatchday = z.infer<typeof createMatchdaySchema>;
export type AddPlayer = z.infer<typeof addPlayerSchema>;
export type PlayerStatus = z.infer<typeof playerStatusSchema>;
export type FeeOverride = z.infer<typeof feeOverrideSchema>;
export type SetRoles = z.infer<typeof setRolesSchema>;
export type MarkPaid = z.infer<typeof markPaidSchema>;
export type SearchMembers = z.infer<typeof searchMembersSchema>;
export type SubmitExpense = z.infer<typeof submitExpenseSchema>;
export type RejectExpense = z.infer<typeof rejectExpenseSchema>;
export type ListPendingExpenses = z.infer<typeof listPendingExpensesSchema>;
export type FinishMatch = z.infer<typeof finishMatchSchema>;
export type CancelMatchday = z.infer<typeof cancelMatchdaySchema>;
