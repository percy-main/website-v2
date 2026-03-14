import Stripe from "stripe";

export function createStripe(config: { stripeSecretKey?: string }): Stripe {
  const key = config.stripeSecretKey;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key);
}
