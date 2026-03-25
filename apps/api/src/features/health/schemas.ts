import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.union([z.literal("ok"), z.literal("degraded")]),
  database: z.union([z.literal("connected"), z.literal("disconnected")]),
});
