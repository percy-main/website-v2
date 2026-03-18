import { z } from "zod";

export const gamesListSchema = z.object({
  season: z.coerce.number().int().optional(),
});

export const gameDetailParamsSchema = z.object({
  matchId: z.string().min(1),
});
