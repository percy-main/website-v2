import { z } from "zod";

export const consentStateSchema = z.enum(["granted", "denied", "unknown"]);
export type ConsentState = z.infer<typeof consentStateSchema>;

export const consentRecordSchema = z.object({
  state: z.enum(["granted", "denied"]),
  version: z.string(),
  timestamp: z.string(),
  source: z.enum(["banner", "settings-link", "privacy-page"]),
});

export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const CONSENT_COOKIE_NAME = "pm_consent";
export const CONSENT_COOKIE_MAX_AGE_DAYS = 365;
