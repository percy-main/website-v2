import { z } from "zod";

export const submitScoreSchema = z.object({
  game: z.string().default("be-the-keeper"),
  score: z.number().int(),
  level: z.number().int(),
  catches: z.number().int(),
  bestStreak: z.number().int(),
});

export const leaderboardQuerySchema = z.object({
  game: z.string().default("be-the-keeper"),
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

export type ScoreInput = z.infer<typeof submitScoreSchema>;

export const leaderboardResponseSchema = z.array(
  z.object({
    name: z.string().nullable(),
    score: z.number(),
    level: z.number(),
    catches: z.number(),
    bestStreak: z.number(),
  }),
);

export const submitScoreResponseSchema = z.object({
  saved: z.boolean(),
  isNewBest: z.boolean(),
});
