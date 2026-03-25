import { z } from "zod";

export const confirmPaymentSchema = z.object({
  paymentIntentId: z.string(),
});

export type ConfirmPayment = z.infer<typeof confirmPaymentSchema>;

const chargeSchema = z.object({
  id: z.string(),
  member_id: z.string(),
  description: z.string(),
  amount_pence: z.number(),
  charge_date: z.string(),
  type: z.string(),
  source: z.string(),
  paid_at: z.string().nullable(),
  payment_confirmed_at: z.string().nullable(),
  payment_method: z.string().nullable(),
  stripe_payment_intent_id: z.string().nullable(),
  deleted_at: z.string().nullable(),
  deleted_by: z.string().nullable(),
  deleted_reason: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string(),
});

export const chargesResponseSchema = z.object({
  charges: z.array(chargeSchema),
});

export const payOutstandingResponseSchema = z.object({
  clientSecret: z.string().nullable(),
  totalAmountPence: z.number(),
  chargeIds: z.array(z.string()),
});

export const confirmPaymentResponseSchema = z.object({
  success: z.literal(true),
});
