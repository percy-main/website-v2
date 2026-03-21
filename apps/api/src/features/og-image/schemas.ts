import { z } from "zod";

export const ogImageParamsSchema = z.object({
  matchId: z.string().min(1),
});
