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
 */
export const invoiceLinesToDuration = (
  lineItems: Stripe.InvoiceLineItem[] | Stripe.LineItem[],
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
