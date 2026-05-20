import { type Duration, add, intervalToDuration } from "date-fns";
import type Stripe from "stripe";

/** Convert a Stripe Unix timestamp (seconds) to a JavaScript Date. */
export const stripeDate = (d: number) => new Date(d * 1000);

/** Sum two date-fns Duration objects. */
const addDurations = (a: Duration, b: Duration): Duration => {
  const base = new Date(0);
  return intervalToDuration({
    start: base,
    end: add(add(base, a), b),
  });
};

/**
 * Parse Stripe line items into a combined date-fns Duration.
 *
 * - One-time prices are treated as 12 months.
 * - Recurring prices use the interval and interval_count.
 * - Unknown items contribute zero duration.
 *
 * Accepts checkout-session `LineItem`s or `SubscriptionItem`s — both expose
 * a `.price` with the `type`/`recurring` we need. `InvoiceLineItem` is not
 * supported: in API 2025-03-31.basil onwards its `price` field moved to
 * `pricing.price_details.price` and is not expanded on webhook payloads,
 * so callers should resolve the subscription and pass its items instead.
 */
export const invoiceLinesToDuration = (
  lineItems: Stripe.LineItem[] | Stripe.SubscriptionItem[],
): Duration =>
  lineItems
    .map((li): Duration => {
      if (li.price?.type === "one_time") {
        return { months: 12 };
      }

      if (li.price?.recurring?.interval) {
        return {
          [`${li.price.recurring.interval}s`]:
            li.price.recurring.interval_count,
        };
      }

      return { days: 0 };
    })
    .reduce(addDurations, { days: 0 });
