import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type Stripe from "stripe";

export interface ChargeOnBehalfOf {
  memberId: string;
  name: string | null;
}

/**
 * Resolve which member rows a given member can see (and pay) charges
 * for. A member with parent links is treated as a junior whose charges
 * are routed to their parent(s) — they see nothing themselves. A
 * member who is named as a parent_member_id in any link absorbs those
 * juniors' charges into their own list.
 */
async function getVisibleMembers(db: Kysely<DB>, memberId: string) {
  const parents = await db
    .selectFrom("member_parent_link")
    .where("member_id", "=", memberId)
    .select("parent_member_id")
    .execute();

  const juniors = await db
    .selectFrom("member_parent_link")
    .innerJoin("member", "member.id", "member_parent_link.member_id")
    .where("member_parent_link.parent_member_id", "=", memberId)
    .select(["member.id", "member.name"])
    .execute();

  const ownVisible = parents.length === 0;
  const ids = [...(ownVisible ? [memberId] : []), ...juniors.map((j) => j.id)];
  const juniorNameById = new Map(juniors.map((j) => [j.id, j.name]));

  return { ids, juniorNameById };
}

function attributeOnBehalfOf<T extends { member_id: string }>(
  charges: T[],
  selfMemberId: string,
  juniorNameById: Map<string, string | null>,
): Array<T & { on_behalf_of: ChargeOnBehalfOf | null }> {
  return charges.map((c) => ({
    ...c,
    on_behalf_of:
      c.member_id === selfMemberId
        ? null
        : {
            memberId: c.member_id,
            name: juniorNameById.get(c.member_id) ?? null,
          },
  }));
}

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

    const { ids, juniorNameById } = await getVisibleMembers(db, member.id);
    if (ids.length === 0) {
      return [];
    }

    const charges = await db
      .selectFrom("charge")
      .where("member_id", "in", ids)
      .where("deleted_at", "is", null)
      // Relieved charges are kept in the response so the member can see
      // "Waived" in their payment history. The frontend excludes them
      // from the "Outstanding" list, and payOutstandingCharges below
      // re-filters relieved on the server so they can never be charged.
      .selectAll()
      .orderBy("charge_date", "desc")
      .execute();

    return attributeOnBehalfOf(charges, member.id, juniorNameById);
  };
}

export function payOutstandingCharges(db: Kysely<DB>, stripe: Stripe) {
  return async (email: string, scopeChargeIds?: string[]) => {
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

    return await db.transaction().execute(async (trx) => {
      const { ids: visibleIds } = await getVisibleMembers(trx, member.id);
      if (visibleIds.length === 0) {
        const error = new Error("No unpaid charges found") as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        throw error;
      }

      // When scopeChargeIds is provided (#93 — junior registration
      // pays only the charge it created), narrow the bundle. The
      // member_id WHERE still applies, so a malicious client passing
      // someone else's chargeIds can only affect rows owned by a
      // member they are entitled to pay for (self or linked junior).
      let query = trx
        .selectFrom("charge")
        .where("member_id", "in", visibleIds)
        .where("deleted_at", "is", null)
        .where("relieved_at", "is", null)
        .where("paid_at", "is", null)
        .where("payment_confirmed_at", "is", null);
      if (scopeChargeIds && scopeChargeIds.length > 0) {
        query = query.where("id", "in", scopeChargeIds);
      }
      const unpaidCharges = await query
        .select(["id", "amount_pence", "stripe_payment_intent_id"])
        .forUpdate()
        .execute();

      if (unpaidCharges.length === 0) {
        const error = new Error("No unpaid charges found") as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        throw error;
      }

      // Charges with an existing PI might be retryable if the PI was
      // abandoned/cancelled. Check Stripe and clear stale ones so they
      // can be bundled into a new PI.
      //
      // For linked-junior charges (shared between multiple parents),
      // only clear if the existing PI was started by THIS user — a
      // mid-flight PI started by the other parent must not be
      // overwritten or we'd risk double-charging (their PI succeeds
      // against an unrelated charge row). `canceled` is always safe
      // to clear because the PI cannot succeed.
      for (const charge of unpaidCharges) {
        if (!charge.stripe_payment_intent_id) continue;
        const pi = await stripe.paymentIntents.retrieve(
          charge.stripe_payment_intent_id,
        );
        const startedByThisUser = pi.metadata?.memberEmail === email;
        const shouldClear =
          pi.status === "canceled" ||
          (pi.status === "requires_payment_method" && startedByThisUser);
        if (shouldClear) {
          await trx
            .updateTable("charge")
            .set({ stripe_payment_intent_id: null })
            .where("id", "=", charge.id)
            .execute();
          charge.stripe_payment_intent_id = null;
        }
      }

      const payableCharges = unpaidCharges.filter(
        (c) => !c.stripe_payment_intent_id,
      );

      if (payableCharges.length === 0) {
        const error = new Error("No unpaid charges found") as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        throw error;
      }

      const totalAmountPence = payableCharges.reduce(
        (sum, c) => sum + c.amount_pence,
        0,
      );

      const chargeIds = payableCharges.map((c) => c.id);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmountPence,
        currency: "gbp",
        automatic_payment_methods: { enabled: true },
        metadata: {
          type: "charges",
          memberEmail: email,
        },
      });

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

    const { ids: visibleIds } = await getVisibleMembers(db, member.id);
    if (visibleIds.length === 0) {
      return;
    }

    await db
      .updateTable("charge")
      .set({ payment_confirmed_at: new Date().toISOString() })
      .where("member_id", "in", visibleIds)
      .where("stripe_payment_intent_id", "=", paymentIntentId)
      .where("paid_at", "is", null)
      .where("payment_confirmed_at", "is", null)
      // A relief approval mid-flight must not be silently overwritten
      // by a confirmPayment race.
      .where("relieved_at", "is", null)
      .execute();
  };
}
