import type { DB } from "@percy-main/db";
import {
  computeOutcomeCutoffDate,
  type MarketingEventType,
} from "@percy-main/shared/marketing";
import { sql, type Kysely } from "kysely";
import type { LeadItem, ListLeadsQuery } from "./admin-schemas.ts";

interface AttributionShape {
  first_seen_at?: string;
}

function computeAdsCutoff(
  campaignId: string | null,
  attribution: unknown,
): string | null {
  if (!campaignId) return null;
  const attr = attribution as AttributionShape | null;
  const firstSeenAt = attr?.first_seen_at;
  if (!firstSeenAt) return null;
  // For both attended and member outcomes; takes the earlier cutoff so the
  // admin sees the worst-case window.
  const candidates: MarketingEventType[] = [
    "lead_attended_session",
    "lead_became_member",
  ];
  let earliest: Date | null = null;
  for (const t of candidates) {
    const cutoff = computeOutcomeCutoffDate(campaignId, t, firstSeenAt);
    if (cutoff && (!earliest || cutoff < earliest)) earliest = cutoff;
  }
  return earliest ? earliest.toISOString() : null;
}

export function listLeads(db: Kysely<DB>) {
  return async (params: ListLeadsQuery) => {
    const { page, pageSize, search, campaignId, segment, status, source } =
      params;
    const offset = (page - 1) * pageSize;

    let baseQuery = db.selectFrom("lead");

    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb("lead.name", "ilike", term),
          eb("lead.email", "ilike", term),
        ]),
      );
    }
    if (campaignId) {
      baseQuery = baseQuery.where("lead.first_campaign_id", "=", campaignId);
    }
    if (segment) {
      baseQuery = baseQuery.where("lead.first_segment", "=", segment);
    }
    if (status) {
      baseQuery = baseQuery.where("lead.status", "=", status);
    }
    if (source) {
      baseQuery = baseQuery.where("lead.source", "=", source);
    }
    if (params.from) {
      baseQuery = baseQuery.where("lead.created_at", ">=", params.from);
    }
    if (params.to) {
      baseQuery = baseQuery.where("lead.created_at", "<=", params.to);
    }

    const [countRow, leadsRows] = await Promise.all([
      baseQuery
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow(),
      baseQuery
        .leftJoin(
          (eb) =>
            eb
              .selectFrom("marketing_event")
              .select((sb) => [
                "marketing_event.lead_id",
                sb.fn.max("marketing_event.created_at").as("last_event_at"),
              ])
              .groupBy("marketing_event.lead_id")
              .as("last_event"),
          (join) => join.onRef("last_event.lead_id", "=", "lead.id"),
        )
        .leftJoin("marketing_event as latest", (join) =>
          join
            .onRef("latest.lead_id", "=", "last_event.lead_id")
            .onRef("latest.created_at", "=", "last_event.last_event_at"),
        )
        .select([
          "lead.id",
          "lead.email",
          "lead.name",
          "lead.phone",
          "lead.source",
          "lead.first_campaign_id",
          "lead.first_segment",
          "lead.status",
          "lead.member_id",
          "lead.consent_ad_user_data",
          "lead.consent_ad_storage",
          "lead.notes",
          "lead.attribution",
          "lead.created_at",
          "lead.updated_at",
          "latest.type as last_event_type",
          "latest.created_at as last_event_at",
        ])
        .orderBy("lead.created_at", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
    ]);

    const items: LeadItem[] = leadsRows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      phone: r.phone,
      source: r.source,
      firstCampaignId: r.first_campaign_id,
      firstSegment: r.first_segment,
      status: r.status,
      memberId: r.member_id,
      consentAdUserData: r.consent_ad_user_data,
      consentAdStorage: r.consent_ad_storage,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastEventType: r.last_event_type,
      lastEventAt: r.last_event_at,
      adsCutoffAt: computeAdsCutoff(r.first_campaign_id, r.attribution),
    }));

    return {
      items,
      total: Number(countRow.total),
      page,
      pageSize,
    };
  };
}

export function getLeadEvents(db: Kysely<DB>) {
  return async (leadId: string) => {
    const rows = await db
      .selectFrom("marketing_event")
      .where("lead_id", "=", leadId)
      .selectAll()
      .orderBy("created_at", "asc")
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        campaignId: r.campaign_id,
        segment: r.segment,
        source: r.source,
        valuePence: r.value_pence,
        currency: r.currency,
        adsConversionAction: r.ads_conversion_action,
        // Cast required: kysely's inferred JSON type cannot be named
        // without referencing __generated__/db.ts (TS2742). The lint
        // rule sees the cast as redundant; the inference does not.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        payload: r.payload as unknown,
        createdAt: r.created_at,
      })),
    };
  };
}

export function listOutbox(db: Kysely<DB>) {
  return async (params: {
    page: number;
    pageSize: number;
    status?: string;
    destination?: string;
  }) => {
    const offset = (params.page - 1) * params.pageSize;
    let q = db
      .selectFrom("marketing_outbox")
      .leftJoin(
        "marketing_event",
        "marketing_event.id",
        "marketing_outbox.event_id",
      );

    if (params.status) {
      q = q.where("marketing_outbox.status", "=", params.status);
    }
    if (params.destination) {
      q = q.where("marketing_outbox.destination", "=", params.destination);
    }

    const [countRow, rows] = await Promise.all([
      q
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow(),
      q
        .select([
          "marketing_outbox.id",
          "marketing_outbox.event_id",
          "marketing_outbox.destination",
          "marketing_outbox.status",
          "marketing_outbox.attempts",
          "marketing_outbox.last_error",
          "marketing_outbox.next_attempt_at",
          "marketing_outbox.succeeded_at",
          "marketing_outbox.created_at",
          "marketing_event.type as event_type",
          "marketing_event.campaign_id",
          "marketing_event.segment",
        ])
        .orderBy("marketing_outbox.created_at", "desc")
        .limit(params.pageSize)
        .offset(offset)
        .execute(),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        destination: r.destination,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
        nextAttemptAt: r.next_attempt_at,
        succeededAt: r.succeeded_at,
        createdAt: r.created_at,
        eventType: r.event_type,
        campaignId: r.campaign_id,
        segment: r.segment,
      })),
      total: Number(countRow.total),
      page: params.page,
      pageSize: params.pageSize,
    };
  };
}

export function retryOutbox(db: Kysely<DB>) {
  return async (outboxId: string) => {
    await db
      .updateTable("marketing_outbox")
      .set({
        status: "pending",
        attempts: 0,
        last_error: null,
        next_attempt_at: sql`CURRENT_TIMESTAMP`,
      })
      .where("id", "=", outboxId)
      .execute();
  };
}
