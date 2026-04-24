import { z } from "zod";

export const incidentStatusSchema = z.enum(["new", "in_review", "done"]);
export const incidentSeveritySchema = z.enum(["low", "medium", "high"]);
export const injurySeveritySchema = z.enum(["minor", "serious", "fatal"]);
export const incidentTypeSchema = z.enum([
  "injury",
  "near_miss",
  "dangerous_occurrence",
  "ill_health",
  "property_damage",
]);
export const reporterRelationshipSchema = z.enum([
  "member",
  "parent_or_guardian",
  "player",
  "coach_or_volunteer",
  "visitor",
  "other",
]);
export const affectedRelationshipSchema = z.enum([
  "trustee",
  "member",
  "volunteer",
  "visitor",
  "contractor",
  "other",
]);

/**
 * Public submission schema. The `website` field is a honeypot — humans leave
 * it blank, bots tend to fill it. The route short-circuits if it has a value.
 * Mirrors PMCSC form POL006a Section 1.
 */
export const incidentReportSubmissionSchema = z.object({
  // Reporter
  reporterName: z.string().min(1).max(200),
  reporterEmail: z.email(),
  reporterPhone: z.string().max(50).optional(),
  reporterRelationship: reporterRelationshipSchema,
  prefersNoContact: z.boolean().default(false),

  // Affected person
  affectedName: z.string().max(200).optional(),
  affectedRelationship: affectedRelationshipSchema.optional(),
  affectedContact: z.string().max(500).optional(),
  affectedIsMinor: z.boolean().default(false),

  // Incident
  occurredAt: z.string().min(1),
  location: z.string().min(1).max(300),
  activity: z.string().max(300).optional(),
  incidentType: incidentTypeSchema,
  description: z.string().min(1).max(5000),

  // Injury / ill health
  injuryOccurred: z.boolean().default(false),
  natureOfInjury: z.string().max(1000).optional(),
  bodyPartsAffected: z.string().max(500).optional(),
  injurySeverity: injurySeveritySchema.optional(),
  firstAidGiven: z.boolean().default(false),
  firstAiderName: z.string().max(200).optional(),
  firstAidDetails: z.string().max(2000).optional(),
  medicalTreatmentRequired: z.boolean().default(false),

  // Actions and witnesses
  immediateActions: z.string().max(2000).optional(),
  witnesses: z.string().max(2000).optional(),

  // Declaration — must be ticked (true) to submit.
  declarationConfirmed: z.literal(true),

  // Honeypot — must be empty for real submissions.
  website: z.string().max(0).optional(),
});

export type IncidentReportSubmission = z.infer<
  typeof incidentReportSubmissionSchema
>;

export const incidentReportSubmissionResponseSchema = z.object({
  id: z.string(),
});

export const listIncidentReportsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: incidentStatusSchema.optional(),
});

export type ListIncidentReports = z.infer<typeof listIncidentReportsSchema>;

const incidentReportSummarySchema = z.object({
  id: z.string(),
  status: incidentStatusSchema,
  severity: incidentSeveritySchema.nullable(),
  incidentType: incidentTypeSchema,
  reporterName: z.string(),
  affectedIsMinor: z.boolean(),
  injuryOccurred: z.boolean(),
  injurySeverity: injurySeveritySchema.nullable(),
  location: z.string(),
  occurredAt: z.string(),
  createdAt: z.string(),
});

export const listIncidentReportsResponseSchema = z.object({
  reports: z.array(incidentReportSummarySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const incidentReportIdParamSchema = z.object({
  id: z.string().min(1),
});

export const incidentReportDetailSchema = z.object({
  id: z.string(),

  reporterName: z.string(),
  reporterEmail: z.string(),
  reporterPhone: z.string().nullable(),
  reporterRelationship: z.string(),
  prefersNoContact: z.boolean(),

  affectedName: z.string().nullable(),
  affectedRelationship: z.string().nullable(),
  affectedContact: z.string().nullable(),
  affectedIsMinor: z.boolean(),

  occurredAt: z.string(),
  location: z.string(),
  activity: z.string().nullable(),
  incidentType: incidentTypeSchema,
  description: z.string(),

  injuryOccurred: z.boolean(),
  natureOfInjury: z.string().nullable(),
  bodyPartsAffected: z.string().nullable(),
  injurySeverity: injurySeveritySchema.nullable(),
  firstAidGiven: z.boolean(),
  firstAiderName: z.string().nullable(),
  firstAidDetails: z.string().nullable(),
  medicalTreatmentRequired: z.boolean(),

  immediateActions: z.string().nullable(),
  witnesses: z.string().nullable(),
  declarationConfirmed: z.boolean(),

  status: incidentStatusSchema,
  severity: incidentSeveritySchema.nullable(),
  ownerUserId: z.string().nullable(),
  ownerName: z.string().nullable(),
  actionsTaken: z.string().nullable(),
  targetCompletionDate: z.string().nullable(),
  riddorRequired: z.boolean().nullable(),
  riddorReportedAt: z.string().nullable(),
  internalNotes: z.string().nullable(),
  closureReason: z.string().nullable(),
  closedAt: z.string().nullable(),
  safeguardingDiscussed: z.boolean(),
  safeguardingDiscussedAt: z.string().nullable(),
  safeguardingNotes: z.string().nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Admin update — every field optional. Pass `null` to clear, omit to leave
 * unchanged. Date fields accept ISO datetime strings.
 */
export const incidentReportAdminUpdateSchema = z.object({
  status: incidentStatusSchema.optional(),
  severity: incidentSeveritySchema.nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
  actionsTaken: z.string().max(5000).nullable().optional(),
  targetCompletionDate: z.string().nullable().optional(),
  riddorRequired: z.boolean().nullable().optional(),
  riddorReportedAt: z.string().nullable().optional(),
  internalNotes: z.string().max(5000).nullable().optional(),
  closureReason: z.string().max(2000).nullable().optional(),
  closedAt: z.string().nullable().optional(),
  safeguardingDiscussed: z.boolean().optional(),
  safeguardingDiscussedAt: z.string().nullable().optional(),
  safeguardingNotes: z.string().max(2000).nullable().optional(),
});

export type IncidentReportAdminUpdate = z.infer<
  typeof incidentReportAdminUpdateSchema
>;

export const successResponseSchema = z.object({
  success: z.boolean(),
});
