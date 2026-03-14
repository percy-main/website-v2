import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";

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
