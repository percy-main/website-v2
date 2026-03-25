import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type Stripe from "stripe";

export function getMyCharges(db: Kysely<DB>) {
  return async (email: string) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .select(["id"])
      .executeTakeFirst();

    if (!member) {
      return [];
    }

    const charges = await db
      .selectFrom("charge")
      .where("member_id", "=", member.id)
      .where("deleted_at", "is", null)
      .selectAll()
      .orderBy("charge_date", "desc")
      .execute();

    return charges;
  };
}

export function payOutstandingCharges(db: Kysely<DB>, stripe: Stripe) {
  return async (email: string) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .select(["id"])
      .executeTakeFirst();

    if (!member) {
      const error = new Error("No member record found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    // Use a transaction with FOR UPDATE to prevent concurrent requests
    // from creating duplicate PaymentIntents for the same charges
    return await db.transaction().execute(async (trx) => {
      const unpaidCharges = await trx
        .selectFrom("charge")
        .where("member_id", "=", member.id)
        .where("deleted_at", "is", null)
        .where("paid_at", "is", null)
        .where("payment_confirmed_at", "is", null)
        .select(["id", "amount_pence"])
        .forUpdate()
        .execute();

      if (unpaidCharges.length === 0) {
        const error = new Error("No unpaid charges found") as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        throw error;
      }

      const totalAmountPence = unpaidCharges.reduce(
        (sum, c) => sum + c.amount_pence,
        0,
      );

      const chargeIds = unpaidCharges.map((c) => c.id);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmountPence,
        currency: "gbp",
        automatic_payment_methods: { enabled: true },
        metadata: {
          type: "charges",
          memberEmail: email,
        },
      });

      // Link charges to the payment intent within the same transaction
      await trx
        .updateTable("charge")
        .set({ stripe_payment_intent_id: paymentIntent.id })
        .where("id", "in", chargeIds)
        .execute();

      return {
        clientSecret: paymentIntent.client_secret,
        totalAmountPence,
        chargeIds,
      };
    });
  };
}

export function confirmPayment(db: Kysely<DB>) {
  return async (email: string, paymentIntentId: string) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .select(["id"])
      .executeTakeFirst();

    if (!member) {
      const error = new Error("No member record found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    await db
      .updateTable("charge")
      .set({ payment_confirmed_at: new Date().toISOString() })
      .where("member_id", "=", member.id)
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      .execute();
  };
}
