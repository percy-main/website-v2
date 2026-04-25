import { z } from "zod";
import { attributionSchema } from "./attribution.ts";
import { consentStateSchema } from "./consent.ts";

export const marketingConsentSnapshotSchema = z.object({
  ad_user_data: consentStateSchema,
  ad_storage: consentStateSchema,
  version: z.string(),
  recordedAt: z.string(),
});

export type MarketingConsentSnapshot = z.infer<
  typeof marketingConsentSnapshotSchema
>;

export const marketingLeadSchema = z.object({
  campaignId: z.string().min(1),
  segment: z.string().optional(),
  name: z.string().min(1),
  email: z.email(),
  phone: z.string().optional(),
  source: z.string().min(1),
  fields: z.record(z.string(), z.unknown()).optional(),
  attribution: attributionSchema.optional(),
  consent: marketingConsentSnapshotSchema,
  honeypot: z.string().optional(),
});

export type MarketingLead = z.infer<typeof marketingLeadSchema>;

export const marketingLeadResponseSchema = z.object({
  leadId: z.string(),
});

export const leadOutcomeSchema = z.object({
  outcome: z.enum(["contacted", "attended", "joined", "lost"]),
  notes: z.string().optional(),
  memberId: z.string().optional(),
});

export type LeadOutcome = z.infer<typeof leadOutcomeSchema>;
