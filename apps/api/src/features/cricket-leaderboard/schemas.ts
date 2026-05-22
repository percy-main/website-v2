import { z } from "zod";

export const cricketLeaderboardQuerySchema = z.object({
  season: z.coerce.number().int().min(2000).max(2100).optional(),
  isJunior: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  teamId: z.string().optional(),
  competitionTypes: z.string().optional(),
  // "Standard" (hardball) is the default; "Pairs" returns Women's Softball
  // leaderboards using the same unified average formula.
  gameType: z.enum(["Standard", "Pairs"]).default("Standard"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export type CricketLeaderboardQuery = z.infer<
  typeof cricketLeaderboardQuerySchema
>;

const battingEntrySchema = z.object({
  playerId: z.string(),
  playerName: z.string().nullable(),
  slug: z.string().nullable(),
  innings: z.number(),
  notOuts: z.number(),
  runs: z.number(),
  highScore: z.number().nullable(),
  average: z.number().nullable(),
  strikeRate: z.number().nullable(),
  fours: z.number(),
  sixes: z.number(),
  fifties: z.number(),
  hundreds: z.number(),
});

export const battingLeaderboardResponseSchema = z.object({
  entries: z.array(battingEntrySchema),
});

const bowlingEntrySchema = z.object({
  playerId: z.string(),
  playerName: z.string().nullable(),
  slug: z.string().nullable(),
  matches: z.number(),
  overs: z.string(),
  maidens: z.number(),
  runs: z.number(),
  wickets: z.number(),
  average: z.number().nullable(),
  economy: z.number().nullable(),
  strikeRate: z.number().nullable(),
  bestBowling: z.string(),
});

export const bowlingLeaderboardResponseSchema = z.object({
  entries: z.array(bowlingEntrySchema),
});
