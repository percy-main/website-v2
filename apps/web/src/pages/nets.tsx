import { getPriceId } from "@/lib/stripe-env";
import { Navigate } from "react-router";

/**
 * Marketing shortcut: /nets redirects to the purchase page
 * for the nets Stripe price.
 */
export function Component() {
  return <Navigate to={`/purchase/${getPriceId("nets")}`} replace />;
}
