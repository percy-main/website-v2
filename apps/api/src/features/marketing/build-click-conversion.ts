import {
  ADS_OFFLINE_MAX_DAYS,
  computeOutcomeCutoffDate,
  resolveAdsConversionAction,
  type MarketingEventType,
} from "@percy-main/shared/marketing";
import { createHash } from "node:crypto";
import type { ClickConversionPayload } from "./ads-client.ts";

interface AttributionShape {
  gclid?: string;
  first_seen_at?: string;
}

export interface LeadRowForBuild {
  email: string;
  attribution: unknown;
  consent_ad_user_data: string;
  consent_ad_storage: string;
}

export interface EventRowForBuild {
  id: string;
  type: MarketingEventType;
  campaign_id: string | null;
  segment: string | null;
  ads_conversion_action: string | null;
  value_pence: number | null;
  currency: string | null;
  created_at: string;
}

export interface BuildResult {
  payload: ClickConversionPayload | null;
  /**
   * Reason for skipping when payload is null. Recorded on the outbox row
   * so admins can see why an event wasn't uploaded.
   */
  skipReason?:
    | "no_match"
    | "past_window"
    | "no_consent"
    | "missing_action"
    | "no_value";
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function mapConsentToAds(state: string): "GRANTED" | "DENIED" | "UNSPECIFIED" {
  if (state === "granted") return "GRANTED";
  if (state === "denied") return "DENIED";
  return "UNSPECIFIED";
}

function isPastWindow(
  campaignId: string,
  eventType: MarketingEventType,
  firstSeenAt: string | undefined,
  now: Date,
): boolean {
  if (!firstSeenAt) return false;
  const cutoff = computeOutcomeCutoffDate(campaignId, eventType, firstSeenAt);
  if (cutoff) return now > cutoff;

  // Fallback for events without an outcome window (e.g. generate_lead before
  // we configure the window): cap at the global Ads max.
  const base = new Date(firstSeenAt);
  if (Number.isNaN(base.getTime())) return false;
  const globalCutoff = new Date(
    base.getTime() + ADS_OFFLINE_MAX_DAYS * 24 * 60 * 60 * 1000,
  );
  return now > globalCutoff;
}

/**
 * Translate a marketing_event + lead pair into the Ads ClickConversion
 * shape. Consent and attribution-aware per CONVERSION_TRACKING.md §11.
 */
export function buildClickConversion(input: {
  event: EventRowForBuild;
  lead: LeadRowForBuild | null;
  now?: Date;
}): BuildResult {
  const { event, lead } = input;
  const now = input.now ?? new Date();

  if (!event.ads_conversion_action) {
    return { payload: null, skipReason: "missing_action" };
  }

  const attribution = lead?.attribution as AttributionShape | null;
  const gclid = attribution?.gclid;
  const consent = lead?.consent_ad_user_data ?? "unknown";

  // Resolve campaign-defined value with a sane fallback.
  const value = event.value_pence ?? 0;
  const currency = event.currency ?? "GBP";

  // Past-window check based on the lead's first seen.
  if (event.campaign_id) {
    const past = isPastWindow(
      event.campaign_id,
      event.type,
      attribution?.first_seen_at,
      now,
    );
    if (past) return { payload: null, skipReason: "past_window" };
  }

  // Consent matrix. We never include user_identifiers without granted
  // consent; we never upload anything when there's no matchable signal.
  const hasGclid = Boolean(gclid);
  const consentGranted = consent === "granted";
  const hasEmail = Boolean(lead?.email);

  if (!hasGclid && !consentGranted) {
    // No gclid and no consent for hashed email upload → nothing to match.
    return { payload: null, skipReason: "no_consent" };
  }
  if (!hasGclid && consentGranted && !hasEmail) {
    return { payload: null, skipReason: "no_match" };
  }

  // Resolve resource name from the event row if present, otherwise from the
  // registry (defensive — event rows are written with this already set).
  let resourceName = event.ads_conversion_action;
  if (!resourceName && event.campaign_id) {
    const resolved = resolveAdsConversionAction(
      event.campaign_id,
      event.type,
      event.segment,
    );
    if (resolved) resourceName = resolved.resourceName;
  }
  if (!resourceName) {
    return { payload: null, skipReason: "missing_action" };
  }

  const payload: ClickConversionPayload = {
    conversion_action: resourceName,
    conversion_date_time: formatAdsDateTime(event.created_at),
    conversion_value: value / 100, // Ads expects decimal currency, value_pence is integer pence
    currency_code: currency,
    order_id: event.id,
    consent: {
      ad_user_data: mapConsentToAds(consent),
      ad_personalization: mapConsentToAds(consent),
    },
  };

  if (gclid) payload.gclid = gclid;

  if (consentGranted && lead?.email) {
    payload.user_identifiers = [
      { hashed_email: sha256(lead.email.toLowerCase().trim()) },
    ];
  }

  return { payload };
}

/**
 * Google Ads requires conversion_date_time in
 * "yyyy-mm-dd hh:mm:ss±zz:zz" format. Our created_at is stored as a
 * TEXT ISO 8601 string; we normalise to UTC with explicit offset.
 */
function formatAdsDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}+00:00`;
}
