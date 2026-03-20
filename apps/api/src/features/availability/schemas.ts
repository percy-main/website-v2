import { z } from "zod";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

// ── Param schemas ──

export const requestIdParamSchema = z.object({
  requestId: z.string(),
});

export const requestDateParamSchema = z.object({
  requestId: z.string(),
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
});

export const assignmentIdParamSchema = z.object({
  assignmentId: z.string(),
});

export const responseIdParamSchema = z.object({
  responseId: z.string(),
});

// ── Body schemas ──

export const createRequestSchema = z.object({
  dateFrom: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  dateTo: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
});

export const assignPlayerSchema = z.object({
  fixtureId: z.string(),
  memberId: z.string().optional(),
  playerName: z.string().min(1),
});

export const overrideResponseSchema = z.object({
  status: z.enum(["available", "unavailable"]),
});

export const respondSchema = z.object({
  responses: z.array(
    z.object({
      matchDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
      status: z.enum(["available", "unavailable"]),
      note: z.string().optional(),
    }),
  ),
});

export const updateRequestStatusSchema = z.object({
  status: z.enum(["open", "closed"]),
});

// ── Query schemas ──

export const listRequestsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Types ──

export type CreateRequest = z.infer<typeof createRequestSchema>;
export type AssignPlayer = z.infer<typeof assignPlayerSchema>;
export type OverrideResponse = z.infer<typeof overrideResponseSchema>;
export type Respond = z.infer<typeof respondSchema>;
export type UpdateRequestStatus = z.infer<typeof updateRequestStatusSchema>;
export type ListRequests = z.infer<typeof listRequestsSchema>;
