import type { ApiResponse } from "@/lib/api-client.js";

type Charge = ApiResponse<"/api/charges">["charges"][number];

/**
 * A charge is "open" (outstanding) when none of the four terminal flags
 * are set. `payment_confirmed_at` is the optimistic flag the dialog sets
 * the moment Stripe accepts the payment, before the webhook flips
 * `paid_at` — both excluded so the row leaves Outstanding immediately.
 *
 * Used by both donations.tsx (Outstanding/History split) and home.tsx
 * (the "you owe £X" card), so the two surfaces never disagree about
 * what counts as outstanding.
 */
export function isChargeOpen(c: Charge): boolean {
  return (
    !c.paid_at && !c.deleted_at && !c.relieved_at && !c.payment_confirmed_at
  );
}
