import type { DB } from "@percy-main/db";
import type { Kysely, Transaction } from "kysely";

/**
 * Helper invoked at every charge-creation site that may be eligible
 * for auto-forgiveness. Currently auto-applies only to match_fee
 * charges — membership-family charges go through Stripe checkout and
 * arrive already paid, so relief there is admin-applied via the
 * `/grants/:id/apply-membership` action.
 *
 * Run this inside the same transaction that just inserted the charge.
 * It looks up the member's active grant for `chargeDate` and, if the
 * grant covers `match_fee`, flips the relief audit columns on the
 * row to mark it forgiven from the start. The charge keeps its full
 * `amount_pence` so reporting sums correctly.
 *
 * No-op if there is no active grant, the grant doesn't cover this
 * charge's type, or the grant's date window doesn't include
 * `chargeDate`.
 */
export function applyReliefIfAny(trx: Transaction<DB> | Kysely<DB>) {
  return async (args: {
    chargeId: string;
    memberId: string;
    type: string;
    chargeDate: string;
  }) => {
    if (args.type !== "match_fee") return { applied: false };

    const grant = await trx
      .selectFrom("financial_relief_grant")
      .where("member_id", "=", args.memberId)
      .where("closed_at", "is", null)
      // `effective_from` / `effective_to_exclusive` are DATE columns.
      // Kysely types them as Timestamp (Date | string); the cast keeps
      // string comparison legal at the type level — Postgres compares
      // ISO-formatted dates lexicographically just fine.
      .where("effective_from", "<=", args.chargeDate as unknown as Date)
      .where((eb) =>
        eb.or([
          eb("effective_to_exclusive", "is", null),
          eb("effective_to_exclusive", ">", args.chargeDate as unknown as Date),
        ]),
      )
      .select(["id", "covers_match_fees", "decided_by"])
      .executeTakeFirst();

    if (!grant) return { applied: false };
    if (!grant.covers_match_fees) return { applied: false };

    await trx
      .updateTable("charge")
      .set({
        relieved_at: new Date().toISOString(),
        relieved_by: grant.decided_by,
        relieved_reason: "financial relief",
        relief_grant_id: grant.id,
      })
      .where("id", "=", args.chargeId)
      .execute();

    return { applied: true, grantId: grant.id };
  };
}
