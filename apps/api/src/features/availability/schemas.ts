import { z } from "zod";

// ── Shared ──

export const availabilityStatusSchema = z.enum([
  "available",
  "unavailable",
  "maybe",
]);

// ── Route param schemas ──

export const requestIdParamSchema = z.object({
  requestId: z.string(),
});

export const dateIdParamSchema = z.object({
  dateId: z.string(),
});

// ── Request body schemas ──

export const createRequestSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
});

export const declareAvailabilitySchema = z.object({
  status: availabilityStatusSchema,
  notes: z.string().max(500).optional(),
});

export const setAvailabilityForMemberSchema = z.object({
  memberId: z.string(),
  status: availabilityStatusSchema,
  notes: z.string().max(500).optional(),
});

export const assignPlayerSchema = z.object({
  memberId: z.string(),
  teamId: z.string(),
  opposition: z.string(),
  playCricketMatchId: z.string().optional(),
  competitionType: z.string().optional(),
});

export const unassignPlayerSchema = z.object({
  memberId: z.string(),
  teamId: z.string(),
});

// ── Query schemas ──

export const previewQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
});

export const gridQuerySchema = z.object({
  matchDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
});

// ── Types ──

export type CreateRequest = z.infer<typeof createRequestSchema>;
export type DeclareAvailability = z.infer<typeof declareAvailabilitySchema>;
export type SetAvailabilityForMember = z.infer<
  typeof setAvailabilityForMemberSchema
>;
export type AssignPlayer = z.infer<typeof assignPlayerSchema>;
export type UnassignPlayer = z.infer<typeof unassignPlayerSchema>;
