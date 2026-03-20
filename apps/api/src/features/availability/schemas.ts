import { z } from "zod";

// ── Shared ──

export const availabilityStatusSchema = z.enum([
  "available",
  "unavailable",
  "maybe",
]);

// ── Route param schemas ──

export const teamIdParamSchema = z.object({
  teamId: z.string(),
});

export const dateIdParamSchema = z.object({
  dateId: z.string(),
});

export const availabilityIdParamSchema = z.object({
  dateId: z.string(),
  availabilityId: z.string(),
});

// ── Request body schemas ──

export const createAvailabilityDateSchema = z.object({
  teamId: z.string(),
  matchDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
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
  matchdayId: z.string(),
  memberId: z.string(),
});

export const unassignPlayerSchema = z.object({
  matchdayId: z.string(),
  memberId: z.string(),
});

// ── Query schemas ──

export const listAvailabilityDatesSchema = z.object({
  teamId: z.string(),
});

// ── Types ──

export type CreateAvailabilityDate = z.infer<
  typeof createAvailabilityDateSchema
>;
export type DeclareAvailability = z.infer<typeof declareAvailabilitySchema>;
export type SetAvailabilityForMember = z.infer<
  typeof setAvailabilityForMemberSchema
>;
export type AssignPlayer = z.infer<typeof assignPlayerSchema>;
export type UnassignPlayer = z.infer<typeof unassignPlayerSchema>;
export type ListAvailabilityDates = z.infer<typeof listAvailabilityDatesSchema>;
