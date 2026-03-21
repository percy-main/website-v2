import { z } from "zod";

export const ogImageParamsSchema = z.object({
  matchId: z.string().regex(/^\d+$/).max(20),
});
