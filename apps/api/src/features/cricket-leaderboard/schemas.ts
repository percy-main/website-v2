import { z } from "zod";

export const cricketLeaderboardQuerySchema = z.object({
  season: z.coerce.number().int().min(2000).max(2100),
  isJunior: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  teamId: z.string().optional(),
  competitionTypes: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export type CricketLeaderboardQuery = z.infer<
  typeof cricketLeaderboardQuerySchema
>;
