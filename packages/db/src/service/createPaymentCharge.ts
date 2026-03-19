import { randomUUID } from "crypto";
import type { Kysely } from "kysely";
import type { DB } from "../__generated__/db.ts";

export type ChargeType =
  | "manual"
  | "donation"
  | "membership"
  | "sponsorship"
  | "junior_membership";

export type ChargeSource =
  | "admin"
  | "webhook"
  | "self_service"
  | "historical_import";

interface CreatePaymentChargeParams {
  memberEmail: string;
  description: string;
  amountPence: number;
  chargeDate: Date;
  type: ChargeType;
  source: ChargeSource;
  stripePaymentIntentId?: string;
}

export type CreatePaymentChargeResult =
  | { created: true }
  | { created: false; reason: "no_member" | "duplicate" };

export function createPaymentCharge(db: Kysely<DB>) {
  return async ({
    memberEmail,
    description,
    amountPence,
    chargeDate,
    type,
    source,
    stripePaymentIntentId,
  }: CreatePaymentChargeParams): Promise<CreatePaymentChargeResult> => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", memberEmail)
      .select(["id"])
      .executeTakeFirst();

    if (!member) {
      return { created: false, reason: "no_member" };
    }

    if (stripePaymentIntentId) {
      const existing = await db
        .selectFrom("charge")
        .where("stripe_payment_intent_id", "=", stripePaymentIntentId)
        .where("member_id", "=", member.id)
        .where("type", "=", type)
        .select(["id"])
        .executeTakeFirst();

      if (existing) {
        return { created: false, reason: "duplicate" };
      }
    }

    if (!stripePaymentIntentId) {
      console.warn(
        "createPaymentCharge: inserting charge without stripePaymentIntentId — no dedup protection",
        { memberEmail, type, description },
      );
    }

    await db
      .insertInto("charge")
      .values({
        id: randomUUID(),
        member_id: member.id,
        description,
        amount_pence: amountPence,
        charge_date: chargeDate.toISOString().split("T")[0],
        created_by: "system",
        paid_at: chargeDate.toISOString(),
        stripe_payment_intent_id: stripePaymentIntentId ?? null,
        type,
        source,
      })
      .execute();

    return { created: true };
  };
}
