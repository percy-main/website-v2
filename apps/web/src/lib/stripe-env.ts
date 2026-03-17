import { stripeConfig, type StripeConfig } from "@percy-main/shared";

/**
 * Returns the Stripe config (prices, products) matching the current
 * environment, derived from the VITE_STRIPE_PUBLIC_KEY prefix.
 */
export function getStripeConfig(): StripeConfig {
  const key = import.meta.env.VITE_STRIPE_PUBLIC_KEY as string | undefined;
  if (key?.startsWith("pk_live_")) return stripeConfig.live;
  return stripeConfig.dev;
}
