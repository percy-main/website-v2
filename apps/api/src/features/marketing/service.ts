import type { DB } from "@percy-main/db";
import {
  resolveAdsConversionAction,
  type Attribution,
  type MarketingConsentSnapshot,
  type MarketingEventType,
} from "@percy-main/shared/marketing";
import type { Kysely, Transaction } from "kysely";

export type MarketingEventSource = "browser" | "server" | "admin" | "webhook";

export interface LeadInput {
  email: string;
  name?: string | null;
  phone?: string | null;
  source: string;
  consent?: MarketingConsentSnapshot;
}

export interface EmitMarketingEventInput {
  type: MarketingEventType;
  campaignId?: string | null;
  segment?: string | null;
  attribution?: Attribution | null;
  value?: { pence: number; currency: string } | null;
  payload?: Record<string, unknown> | null;
  source: MarketingEventSource;
  createdBy?: string | null;
  /**
   * If provided, the event is associated with a lead — looked up by email,
   * created if missing. Pass `null` for events that aren't tied to a lead
   * (e.g. anonymous purchases without an upstream lead match).
   */
  lead?: LeadInput | null;
  /**
   * Or directly reference an existing lead by id (admin outcome flow).
   */
  leadId?: string | null;
  userId?: string | null;
}

export interface EmitMarketingEventResult {
  leadId: string | null;
  eventId: string;
  outboxId: string | null;
}

const STATUS_FROM_EVENT: Partial<Record<MarketingEventType, string>> = {
  generate_lead: "new",
  contact_form_submitted: "new",
  lead_contacted: "contacted",
  lead_attended_session: "attended",
  lead_became_member: "joined",
  lead_lost: "lost",
};

async function upsertLead(
  trx: Transaction<DB>,
  input: LeadInput,
  campaignId: string | null,
  segment: string | null,
  attribution: Attribution | null,
): Promise<string> {
  const existing = await trx
    .selectFrom("lead")
    .select([
      "id",
      "first_campaign_id",
      "consent_ad_user_data",
      "consent_ad_storage",
    ])
    .where("email", "=", input.email)
    .executeTakeFirst();

  if (existing) {
    const update: Record<string, unknown> = {};
    if (input.name) update.name = input.name;
    if (input.phone) update.phone = input.phone;
    if (!existing.first_campaign_id && campaignId) {
      update.first_campaign_id = campaignId;
      if (segment) update.first_segment = segment;
    }
    // Consent: ratchet only DOWN. A re-submit that newly DENIES an axis
    // overwrites a stored "granted" - the user has actively withdrawn.
    // We never silently upgrade "denied" to "granted" via re-submit; the
    // user must accept on the banner for that.
    if (input.consent) {
      const newConsent = input.consent;
      if (
        existing.consent_ad_user_data === "granted" &&
        newConsent.ad_user_data === "denied"
      ) {
        update.consent_ad_user_data = "denied";
        update.consent_version = newConsent.version;
        update.consent_recorded_at = newConsent.recordedAt;
      }
      if (
        existing.consent_ad_storage === "granted" &&
        newConsent.ad_storage === "denied"
      ) {
        update.consent_ad_storage = "denied";
        update.consent_version = newConsent.version;
        update.consent_recorded_at = newConsent.recordedAt;
      }
    }
    if (Object.keys(update).length > 0) {
      update.updated_at = new Date().toISOString();
      await trx
        .updateTable("lead")
        .set(update)
        .where("id", "=", existing.id)
        .execute();
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  const consent = input.consent;
  await trx
    .insertInto("lead")
    .values({
      id,
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      source: input.source,
      first_campaign_id: campaignId,
      first_segment: campaignId ? (segment ?? null) : null,
      attribution: attribution ? JSON.stringify(attribution) : null,
      consent_ad_user_data: consent?.ad_user_data ?? "unknown",
      consent_ad_storage: consent?.ad_storage ?? "unknown",
      consent_version: consent?.version ?? null,
      consent_recorded_at: consent?.recordedAt ?? null,
      status: "new",
    })
    .execute();
  return id;
}

/**
 * Updates `lead.status` from a denormalised event type. Status follows the
 * latest funnel-relevant event; non-funnel events (e.g. purchase) are
 * ignored. Always run inside the same transaction as the event insert.
 */
async function maybeUpdateLeadStatus(
  trx: Transaction<DB>,
  leadId: string,
  eventType: MarketingEventType,
): Promise<void> {
  const next = STATUS_FROM_EVENT[eventType];
  if (!next) return;
  await trx
    .updateTable("lead")
    .set({ status: next, updated_at: new Date().toISOString() })
    .where("id", "=", leadId)
    .execute();
}

export function emitMarketingEvent(db: Kysely<DB>) {
  return async (
    input: EmitMarketingEventInput,
  ): Promise<EmitMarketingEventResult> => {
    return db.transaction().execute(async (trx) => {
      const campaignId = input.campaignId ?? null;
      const segment = input.segment ?? null;

      let leadId: string | null = input.leadId ?? null;
      if (!leadId && input.lead) {
        leadId = await upsertLead(
          trx,
          input.lead,
          campaignId,
          segment,
          input.attribution ?? null,
        );
      }

      const adsAction = campaignId
        ? resolveAdsConversionAction(campaignId, input.type, segment)
        : null;

      const eventId = crypto.randomUUID();
      await trx
        .insertInto("marketing_event")
        .values({
          id: eventId,
          lead_id: leadId,
          user_id: input.userId ?? null,
          type: input.type,
          campaign_id: campaignId,
          segment,
          ads_conversion_action: adsAction?.resourceName ?? null,
          value_pence: input.value?.pence ?? null,
          currency: input.value?.currency ?? null,
          attribution: input.attribution
            ? JSON.stringify(input.attribution)
            : null,
          payload: input.payload ? JSON.stringify(input.payload) : null,
          source: input.source,
          created_by: input.createdBy ?? null,
        })
        .execute();

      let outboxId: string | null = null;
      if (adsAction) {
        outboxId = crypto.randomUUID();
        await trx
          .insertInto("marketing_outbox")
          .values({
            id: outboxId,
            event_id: eventId,
            destination: "google_ads",
            status: "pending",
          })
          .execute();
      }

      if (leadId) {
        await maybeUpdateLeadStatus(trx, leadId, input.type);
      }

      return { leadId, eventId, outboxId };
    });
  };
}
