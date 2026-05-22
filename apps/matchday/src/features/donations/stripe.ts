import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Lazy singleton — Stripe.js is ~80kB; only fetched once a player taps "Pay".
let promise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!promise) {
    const key = import.meta.env.VITE_STRIPE_PUBLIC_KEY as string | undefined;
    if (!key) {
      return Promise.resolve(null);
    }
    promise = loadStripe(key);
  }
  return promise;
}
