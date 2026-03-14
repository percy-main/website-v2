import { z } from "zod";

export const confirmPaymentSchema = z.object({
  paymentIntentId: z.string(),
});

export type ConfirmPayment = z.infer<typeof confirmPaymentSchema>;
