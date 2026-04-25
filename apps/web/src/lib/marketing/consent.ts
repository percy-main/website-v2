import {
  CONSENT_COOKIE_MAX_AGE_DAYS,
  CONSENT_COOKIE_NAME,
  consentRecordSchema,
  type ConsentRecord,
} from "@percy-main/shared/marketing";
import { readCookie, writeCookie } from "./cookies.js";

/**
 * Version of the privacy notice this consent record was captured against.
 * Bump when the privacy notice materially changes what we send to Google
 * so returning visitors are re-prompted.
 */
export const CURRENT_CONSENT_VERSION = "2026-04-25";

type ConsentAxis =
  | "ad_storage"
  | "ad_user_data"
  | "ad_personalization"
  | "analytics_storage";

type ConsentUpdate = Record<ConsentAxis, "granted" | "denied">;

interface ConsentSnapshot {
  ad_user_data: "granted" | "denied" | "unknown";
  ad_storage: "granted" | "denied" | "unknown";
}

type ConsentChangeListener = (record: ConsentRecord | null) => void;

const listeners = new Set<ConsentChangeListener>();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function pushGtagConsent(state: "granted" | "denied"): void {
  if (typeof window === "undefined") return;
  const update: ConsentUpdate = {
    ad_storage: state,
    ad_user_data: state,
    ad_personalization: state,
    analytics_storage: state,
  };
  window.gtag?.("consent", "update", update);
}

export function readConsentRecord(): ConsentRecord | null {
  const raw = readCookie(CONSENT_COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = consentRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function getConsent(): ConsentRecord | null {
  return readConsentRecord();
}

export function getConsentSnapshot(): ConsentSnapshot {
  const record = readConsentRecord();
  if (record?.version !== CURRENT_CONSENT_VERSION) {
    return { ad_user_data: "unknown", ad_storage: "unknown" };
  }
  return {
    ad_user_data: record.state,
    ad_storage: record.state,
  };
}

export function writeConsentRecord(record: ConsentRecord): void {
  writeCookie(CONSENT_COOKIE_NAME, JSON.stringify(record), {
    maxAgeSeconds: CONSENT_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
  });
  pushGtagConsent(record.state);
  for (const listener of listeners) listener(record);
}

export function setConsent(
  state: "granted" | "denied",
  source: ConsentRecord["source"] = "banner",
): ConsentRecord {
  const record: ConsentRecord = {
    state,
    version: CURRENT_CONSENT_VERSION,
    timestamp: new Date().toISOString(),
    source,
  };
  writeConsentRecord(record);
  return record;
}

/**
 * True when we have no stored consent at all, or the stored record is for an
 * older privacy-notice version and the user needs to re-decide.
 */
export function needsConsent(): boolean {
  const record = readConsentRecord();
  if (!record) return true;
  return record.version !== CURRENT_CONSENT_VERSION;
}

/**
 * On page load, if we already have a valid consent record, mirror it to gtag
 * inside its wait_for_update window so the default "denied" isn't the final
 * state for this visit.
 */
export function applyStoredConsentToGtag(): void {
  const record = readConsentRecord();
  if (record?.version !== CURRENT_CONSENT_VERSION) return;
  pushGtagConsent(record.state);
}

export function subscribeConsent(listener: ConsentChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const REOPEN_EVENT = "pm-consent-reopen";

export function requestConsentReopen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REOPEN_EVENT));
}

export function onConsentReopenRequested(handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = () => handler();
  window.addEventListener(REOPEN_EVENT, listener);
  return () => {
    window.removeEventListener(REOPEN_EVENT, listener);
  };
}
