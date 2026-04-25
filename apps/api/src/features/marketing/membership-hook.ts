import type { DB } from "@percy-main/db";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { emitMarketingEvent } from "./service.ts";

/**
 * Hook called after a successful membership purchase webhook. Emits a
 * `purchase` event always, and a `lead_became_member` event when the email
 * matches an existing lead row. Marketing failures are caught and logged
 * here - the Stripe webhook handler must remain decoupled.
 */
export async function emitMarketingEventForMembership(
  db: Kysely<DB>,
  log: FastifyBaseLogger,
  input: {
    email: string;
    amountPence: number | null;
    membershipType: string;
  },
): Promise<void> {
  try {
    const lead = await db
      .selectFrom("lead")
      .select(["id", "first_campaign_id", "first_segment", "member_id"])
      .where("email", "=", input.email)
      .executeTakeFirst();

    const emit = emitMarketingEvent(db);

    // 1. Reporting-only purchase event (no Ads upload by default).
    await emit({
      type: "purchase",
      campaignId: lead?.first_campaign_id ?? null,
      segment: lead?.first_segment ?? null,
      source: "webhook",
      leadId: lead?.id ?? null,
      value: input.amountPence
        ? { pence: input.amountPence, currency: "GBP" }
        : null,
      payload: { membershipType: input.membershipType },
    });

    // 2. Mark the lead as a member and emit lead_became_member if applicable.
    if (lead?.first_campaign_id) {
      if (!lead.member_id) {
        const member = await db
          .selectFrom("member")
          .select(["id"])
          .where("email", "=", input.email)
          .executeTakeFirst();
        if (member) {
          await db
            .updateTable("lead")
            .set({
              member_id: member.id,
              updated_at: new Date().toISOString(),
            })
            .where("id", "=", lead.id)
            .execute();
        }
      }

      await emit({
        type: "lead_became_member",
        campaignId: lead.first_campaign_id,
        segment: lead.first_segment,
        source: "webhook",
        leadId: lead.id,
        // Recruit-2026 uses a flat 50 GBP value to keep Smart Bidding from
        // skewing toward adults vs juniors. Honoured at the campaign level
        // via the registry; we pass it through explicitly so the value is
        // visible on the marketing_event row.
        value: { pence: 5000, currency: "GBP" },
      });
    }
  } catch (err) {
    log.warn(
      { err, email: input.email },
      "Marketing pipeline write failed for membership purchase",
    );
  }
}
