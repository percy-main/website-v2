import { stripeConfig, type StripeConfig } from "@percy-main/shared";

/**
 * Returns the Stripe config (prices, products) matching the current
 * environment, derived from the VITE_STRIPE_PUBLIC_KEY prefix.
 */
export function getStripeConfig(): StripeConfig {
  const key = String(import.meta.env.VITE_STRIPE_PUBLIC_KEY ?? "");
  if (key?.startsWith("pk_live_")) return stripeConfig.live;
  return stripeConfig.dev;
}

/** Returns the real Stripe price ID for a known price key. */
export function getPriceId(name: keyof StripeConfig["prices"]): string {
  return getStripeConfig().prices[name];
}
