import { z } from "zod";

export const priceInfoParamsSchema = z.object({
  priceId: z.string(),
});

export const purchaseSchema = z.object({
  priceId: z.string(),
  quantity: z.number().int().positive().optional(),
  customAmountPence: z.number().int().positive().optional(),
  metadata: z.record(z.string()).optional(),
  email: z.string().email().optional(),
});

export const subscribeSchema = z.object({
  priceId: z.string(),
  membership: z.enum([
    "social",
    "senior_player",
    "senior_women_player",
    "concessionary",
  ]),
  email: z.string().email(),
});

export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type SubscribeInput = z.infer<typeof subscribeSchema>;
