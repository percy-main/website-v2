import { z } from "zod";

export const attributionSchema = z.object({
  gclid: z.string().optional(),
  gbraid: z.string().optional(),
  wbraid: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  landing_path: z.string().optional(),
  referrer: z.string().optional(),
  experiment_id: z.string().optional(),
  variant: z.string().optional(),
  first_seen_at: z.string(),
});

export type Attribution = z.infer<typeof attributionSchema>;

export const ATTRIBUTION_COOKIE_NAME = "pm_attrib";
export const ATTRIBUTION_COOKIE_MAX_AGE_DAYS = 90;
export const ATTRIBUTION_COOKIE_MAX_BYTES = 1500;
