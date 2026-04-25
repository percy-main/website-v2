export {
  ATTRIBUTION_COOKIE_MAX_AGE_DAYS,
  ATTRIBUTION_COOKIE_MAX_BYTES,
  ATTRIBUTION_COOKIE_NAME,
  attributionSchema,
  type Attribution,
} from "./attribution.ts";

export {
  CONSENT_COOKIE_MAX_AGE_DAYS,
  CONSENT_COOKIE_NAME,
  consentRecordSchema,
  consentStateSchema,
  type ConsentRecord,
  type ConsentState,
} from "./consent.ts";

export { marketingEventTypeSchema, type MarketingEventType } from "./events.ts";

export {
  ADS_OFFLINE_MAX_DAYS,
  campaigns,
  computeOutcomeCutoffDate,
  getOutcomeWindowDays,
  isCampaignId,
  resolveAdsConversionAction,
  type AssertAllSegmentsHavePrimaryAction,
  type CampaignId,
} from "./campaigns.ts";

export {
  leadOutcomeSchema,
  marketingConsentSnapshotSchema,
  marketingLeadResponseSchema,
  marketingLeadSchema,
  type LeadOutcome,
  type MarketingConsentSnapshot,
  type MarketingLead,
} from "./schemas.ts";
