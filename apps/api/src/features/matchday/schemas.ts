import { z } from "zod";

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
  matchId: z.string(),
  type: z.enum([
    "umpire_fee",
    "scorer_fee",
    "match_ball",
    "teas",
    "miscellaneous",
  ]),
  description: z.string().optional(),
  amountPence: z.number().int().positive(),
  paymentMethod: z.string().optional(),
});

export const updateExpenseSchema = z.object({
  expenseId: z.string(),
  type: z
    .enum(["umpire_fee", "scorer_fee", "match_ball", "teas", "miscellaneous"])
    .optional(),
  description: z.string().optional(),
  amountPence: z.number().int().positive().optional(),
});

export const deleteExpenseSchema = z.object({
  expenseId: z.string(),
});

export type ListMatches = z.infer<typeof listMatchesSchema>;
export type GetMatch = z.infer<typeof getMatchSchema>;
export type RecordExpense = z.infer<typeof recordExpenseSchema>;
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
export type DeleteExpense = z.infer<typeof deleteExpenseSchema>;
