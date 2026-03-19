import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type Stripe from "stripe";
import type { PurchaseInput, SubscribeInput } from "./schemas.ts";

/**
 * Find or create a Stripe customer by email.
 * Updates the member record with the Stripe customer ID if one exists.
 */
export function resolveStripeCustomer(db: Kysely<DB>, stripe: Stripe) {
  return async (email: string): Promise<string> => {
    // Check if customer already exists in Stripe
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      const customerId = existing.data[0].id;

      // Sync to member record if exists
      await db
        .updateTable("member")
        .set({ stripe_customer_id: customerId })
        .where("email", "=", email)
        .where("deleted_at", "is", null)
        .execute();

      return customerId;
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({ email });

    // Sync to member record if exists
    await db
      .updateTable("member")
      .set({ stripe_customer_id: customer.id })
      .where("email", "=", email)
      .where("deleted_at", "is", null)
      .execute();

    return customer.id;
  };
}

/**
 * Create a one-off purchase via Stripe PaymentIntent.
 */
export function createPurchase(db: Kysely<DB>, stripe: Stripe) {
  return async (data: PurchaseInput) => {
    const price = await stripe.prices.retrieve(data.priceId, {
      expand: ["product"],
    });

    const product = price.product as { name: string };

    const amount =
      data.customAmountPence ?? (price.unit_amount ?? 0) * (data.quantity ?? 1);

    const paymentIntentParams: import("stripe").Stripe.PaymentIntentCreateParams =
      {
        amount,
        currency: "gbp",
        metadata: {
          ...data.metadata,
          price_id: data.priceId,
        },
      };

    if (data.email) {
      paymentIntentParams.receipt_email = data.email;
    }

    const paymentIntent =
      await stripe.paymentIntents.create(paymentIntentParams);

    return {
      clientSecret: paymentIntent.client_secret,
      amount,
      productName: product.name,
    };
  };
}

/**
 * Create a subscription with incomplete initial payment.
 * For senior_women_player memberships, sets an automatic cancellation date.
 */
export function createSubscription(db: Kysely<DB>, stripe: Stripe) {
  const resolveCustomer = resolveStripeCustomer(db, stripe);

  return async (data: SubscribeInput) => {
    const customerId = await resolveCustomer(data.email);

    const subscriptionParams: import("stripe").Stripe.SubscriptionCreateParams =
      {
        customer: customerId,
        items: [{ price: data.priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
        },
        expand: ["latest_invoice.payment_intent"],
        metadata: {
          membership: data.membership,
          email: data.email,
        },
      };

    // For senior women players, set cancel_at to the earlier of
    // 6 months from now or September 30th of the current year
    if (data.membership === "senior_women_player") {
      const now = new Date();
      const sixMonths = new Date(now);
      sixMonths.setMonth(sixMonths.getMonth() + 6);

      const year =
        now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
      const sepThirty = new Date(year, 8, 30, 23, 59, 59);

      const cancelAt = sixMonths < sepThirty ? sixMonths : sepThirty;
      subscriptionParams.cancel_at = Math.floor(cancelAt.getTime() / 1000);
    }

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    const invoice = subscription.latest_invoice as {
      payment_intent: { client_secret: string };
    };

    return {
      clientSecret: invoice.payment_intent.client_secret,
      subscriptionId: subscription.id,
    };
  };
}
