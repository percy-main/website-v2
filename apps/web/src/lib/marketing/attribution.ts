import {
  ATTRIBUTION_COOKIE_MAX_AGE_DAYS,
  ATTRIBUTION_COOKIE_MAX_BYTES,
  ATTRIBUTION_COOKIE_NAME,
  attributionSchema,
  type Attribution,
} from "@percy-main/shared/marketing";
import { getConsentSnapshot } from "./consent.js";
import { readCookie, writeCookie } from "./cookies.js";

const ATTRIBUTION_URL_PARAMS = [
  "gclid",
  "gbraid",
  "wbraid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "experiment_id",
  "variant",
] as const;

type AttributionUrlParam = (typeof ATTRIBUTION_URL_PARAMS)[number];

export function readAttribution(): Attribution | null {
  const raw = readCookie(ATTRIBUTION_COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = attributionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function extractParams(url: URL): Partial<Record<AttributionUrlParam, string>> {
  const out: Partial<Record<AttributionUrlParam, string>> = {};
  for (const key of ATTRIBUTION_URL_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) out[key] = value;
  }
  return out;
}

function truncate(payload: Attribution): Attribution {
  const serialised = JSON.stringify(payload);
  if (serialised.length <= ATTRIBUTION_COOKIE_MAX_BYTES) return payload;
  if (payload.referrer && payload.referrer.length > 0) {
    const trimmed: Attribution = { ...payload, referrer: undefined };
    if (JSON.stringify(trimmed).length <= ATTRIBUTION_COOKIE_MAX_BYTES)
      return trimmed;
  }
  const { gclid, utm_source, utm_medium, utm_campaign, first_seen_at } =
    payload;
  return {
    gclid,
    utm_source,
    utm_medium,
    utm_campaign,
    first_seen_at,
  };
}

/**
 * Capture attribution on first touch. Gated on ad_storage consent.
 * First-touch wins — never overwrites an existing cookie.
 */
export function maybeCaptureAttribution(): void {
  if (typeof window === "undefined") return;
  if (readAttribution()) return;

  const consent = getConsentSnapshot();
  if (consent.ad_storage !== "granted") return;

  const url = new URL(window.location.href);
  const params = extractParams(url);
  const hasCampaignSignal =
    Boolean(params.gclid) ||
    Boolean(params.gbraid) ||
    Boolean(params.wbraid) ||
    Boolean(params.utm_source) ||
    Boolean(params.utm_medium) ||
    Boolean(params.utm_campaign);
  if (!hasCampaignSignal) return;

  const attribution: Attribution = {
    ...params,
    landing_path: url.pathname,
    referrer: document.referrer || undefined,
    first_seen_at: new Date().toISOString(),
  };

  const payload = JSON.stringify(truncate(attribution));
  writeCookie(ATTRIBUTION_COOKIE_NAME, payload, {
    maxAgeSeconds: ATTRIBUTION_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
  });
}
