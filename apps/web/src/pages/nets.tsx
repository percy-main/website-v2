import { getStripeConfig } from "@/lib/stripe-env";
import { Navigate } from "react-router";

/**
 * Marketing shortcut: /nets redirects to the purchase page
 * for the nets Stripe price.
 */
export function Component() {
  const { prices } = getStripeConfig();
  return <Navigate to={`/purchase/${prices.nets}`} replace />;
}
