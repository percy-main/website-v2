import { z } from "zod";

export const priceInfoParamsSchema = z.object({
  priceId: z.string(),
});

export const purchaseSchema = z.object({
  priceId: z.string(),
  quantity: z.number().int().positive().optional(),
  customAmountPence: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  email: z.email().optional(),
});

export const subscribeSchema = z.object({
  priceId: z.string(),
  membership: z.enum([
    "social",
    "senior_player",
    "senior_women_player",
    "concessionary",
  ]),
  email: z.email(),
});

export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type SubscribeInput = z.infer<typeof subscribeSchema>;

// Response schemas

export const priceInfoResponseSchema = z.object({
  productName: z.string(),
  unitAmount: z.number(),
  formattedPrice: z.string(),
  customAmount: z
    .object({
      min: z.number(),
      max: z.number().optional(),
      preset: z.number().optional(),
    })
    .optional(),
  qtyAdjustable: z.boolean(),
  maxQty: z.number().optional(),
});

export const purchaseResponseSchema = z.object({
  clientSecret: z.string().nullable(),
  amount: z.number(),
  productName: z.string(),
});

export const subscribeResponseSchema = z.object({
  clientSecret: z.string(),
  subscriptionId: z.string(),
});
