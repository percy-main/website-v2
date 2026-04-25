import { z } from "zod";

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  campaignId: z.string().optional(),
  segment: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

const leadItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  source: z.string(),
  firstCampaignId: z.string().nullable(),
  firstSegment: z.string().nullable(),
  status: z.string(),
  memberId: z.string().nullable(),
  consentAdUserData: z.string(),
  consentAdStorage: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  lastEventType: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  adsCutoffAt: z.string().nullable(),
});

export type LeadItem = z.infer<typeof leadItemSchema>;

export const listLeadsResponseSchema = z.object({
  items: z.array(leadItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const leadEventsQuerySchema = z.object({
  leadId: z.string().min(1),
});

export const leadEventItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  campaignId: z.string().nullable(),
  segment: z.string().nullable(),
  source: z.string(),
  valuePence: z.number().nullable(),
  currency: z.string().nullable(),
  adsConversionAction: z.string().nullable(),
  payload: z.unknown().nullable(),
  createdAt: z.string(),
});

export const leadEventsResponseSchema = z.object({
  items: z.array(leadEventItemSchema),
});

export const leadIdParamSchema = z.object({
  leadId: z.string().min(1),
});

export const adminOutcomeBodySchema = z.object({
  outcome: z.enum(["contacted", "attended", "joined", "lost"]),
  notes: z.string().optional(),
  memberId: z.string().optional(),
});

export const adminOutcomeResponseSchema = z.object({
  ok: z.literal(true),
  eventId: z.string(),
});

export const listOutboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.string().optional(),
  destination: z.string().optional(),
});

export const outboxItemSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  destination: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string(),
  succeededAt: z.string().nullable(),
  createdAt: z.string(),
  eventType: z.string().nullable(),
  campaignId: z.string().nullable(),
  segment: z.string().nullable(),
});

export const listOutboxResponseSchema = z.object({
  items: z.array(outboxItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const retryOutboxParamSchema = z.object({
  outboxId: z.string().min(1),
});

export const retryOutboxResponseSchema = z.object({
  ok: z.literal(true),
});
