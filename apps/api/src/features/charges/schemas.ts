import { z } from "zod";

export const confirmPaymentSchema = z.object({
  paymentIntentId: z.string(),
});

export type ConfirmPayment = z.infer<typeof confirmPaymentSchema>;

/**
 * Optional scope for pay-outstanding (#93). When `chargeIds` is set,
 * the bundle is restricted to those charges (and only the
 * authenticated member's). When omitted, every unpaid charge for the
 * member is bundled — the original behaviour, kept for the members
 * "Pay outstanding" page where the user explicitly wants \"all of it
 * at once\".
 */
export const payOutstandingSchema = z.object({
  // .min(1) so an explicit empty array doesn't silently fall through
  // to "pay everything outstanding" — that contract requires the
  // chargeIds key to be omitted entirely.
  chargeIds: z.array(z.string()).min(1).optional(),
});

export type PayOutstanding = z.infer<typeof payOutstandingSchema>;

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
  relieved_at: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string(),
  // Set when the charge belongs to a linked junior member rather than
  // the authenticated user — used to label "For [Junior name]" in the
  // user-facing charges list.
  on_behalf_of: z
    .object({ memberId: z.string(), name: z.string().nullable() })
    .nullable(),
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
