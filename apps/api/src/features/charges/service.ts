import { client } from "@percy-main/db";

export async function getMyCharges(email: string) {
  const member = await client
    .selectFrom("member")
    .where("email", "=", email)
    .select(["id"])
    .executeTakeFirst();

  if (!member) {
    return [];
  }

  const charges = await client
    .selectFrom("charge")
    .where("member_id", "=", member.id)
    .where("deleted_at", "is", null)
    .selectAll()
    .orderBy("charge_date", "desc")
    .execute();

  return charges;
}

export async function confirmPayment(
  email: string,
  paymentIntentId: string,
) {
  const member = await client
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

  await client
    .updateTable("charge")
    .set({ payment_confirmed_at: new Date().toISOString() })
    .where("member_id", "=", member.id)
    .where("stripe_payment_intent_id", "=", paymentIntentId)
    .where("paid_at", "is", null)
    .where("payment_confirmed_at", "is", null)
    .execute();
}
