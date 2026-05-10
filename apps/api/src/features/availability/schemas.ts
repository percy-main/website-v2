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

export const requestDateMemberParamSchema = z.object({
  requestId: z.string(),
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  memberId: z.string(),
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

export const setAvailabilitySchema = z.object({
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

// ── Response schemas ──

export const createRequestResponseSchema = z.object({
  id: z.string(),
  fixtureCount: z.number(),
});

const requestItemSchema = z.object({
  id: z.string(),
  date_from: z.string(),
  date_to: z.string(),
  status: z.string(),
  created_at: z.string(),
  created_by: z.string(),
  created_by_name: z.string().nullable(),
  fixtureCount: z.number(),
  respondentCount: z.number(),
});

export const listRequestsResponseSchema = z.object({
  items: z.array(requestItemSchema),
});

const fixtureSchema = z.object({
  id: z.string(),
  availability_request_id: z.string(),
  match_date: z.string(),
  play_cricket_match_id: z.string(),
  play_cricket_team_id: z.string(),
  opposition: z.string(),
  is_home: z.boolean(),
  competition_name: z.string().nullable(),
  competition_type: z.string().nullable(),
  match_time: z.string().nullable(),
});

const dateEntrySchema = z.object({
  date: z.string(),
  fixtures: z.array(fixtureSchema),
  responseCount: z.number(),
  assignmentCount: z.number(),
});

export const getRequestResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    date_from: z.string(),
    date_to: z.string(),
    status: z.string(),
    created_at: z.string(),
    created_by: z.string(),
    created_by_name: z.string().nullable(),
  }),
  dates: z.array(dateEntrySchema),
});

const assignmentSchema = z.object({
  id: z.string(),
  availability_fixture_id: z.string(),
  member_id: z.string().nullable(),
  player_name: z.string(),
  position: z.number(),
  created_at: z.string(),
});

const responseItemSchema = z.object({
  id: z.string(),
  member_id: z.string(),
  status: z.string(),
  note: z.string().nullable(),
  overridden_by: z.string().nullable(),
  member_name: z.string().nullable(),
});

const memberPoolItemSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  member_category: z.string().nullable(),
});

const dateDetailFixtureSchema = z.object({
  id: z.string(),
  match_date: z.string(),
  play_cricket_match_id: z.string(),
  play_cricket_team_id: z.string(),
  opposition: z.string(),
  is_home: z.boolean(),
  competition_name: z.string().nullable(),
  match_time: z.string().nullable(),
  team_name: z.string().nullable(),
  assignments: z.array(assignmentSchema),
});

export const getDateDetailResponseSchema = z.object({
  requestStatus: z.string(),
  fixtures: z.array(dateDetailFixtureSchema),
  pools: z.object({
    available: z.array(responseItemSchema),
    unavailable: z.array(responseItemSchema),
    noResponse: z.array(memberPoolItemSchema),
  }),
  assignedMemberIds: z.array(z.string()),
});

export const assignPlayerResponseSchema = z.object({
  id: z.string(),
  position: z.number(),
});

export const successResponseSchema = z.object({
  success: z.boolean(),
});

export const confirmDateResponseSchema = z.object({
  matchdays: z.array(
    z.object({
      fixtureId: z.string(),
      matchdayId: z.string(),
    }),
  ),
});

const activeFixtureSchema = z.object({
  id: z.string(),
  availability_request_id: z.string(),
  match_date: z.string(),
  play_cricket_team_id: z.string(),
  play_cricket_match_id: z.string(),
  opposition: z.string(),
  is_home: z.boolean(),
  competition_name: z.string().nullable(),
  match_time: z.string().nullable(),
  team_name: z.string().nullable(),
});

const myResponseSchema = z.object({
  id: z.string(),
  availability_request_id: z.string(),
  match_date: z.string(),
  status: z.string(),
  note: z.string().nullable(),
});

export const getActiveRequestsResponseSchema = z.object({
  memberId: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      created_by: z.string(),
      date_from: z.string(),
      date_to: z.string(),
      status: z.string(),
      created_at: z.string(),
      fixtures: z.array(activeFixtureSchema),
      myResponses: z.array(myResponseSchema),
    }),
  ),
});

const previewFixtureSchema = z.object({
  matchDate: z.string(),
  playCricketMatchId: z.string(),
  teamName: z.string(),
  opposition: z.string(),
  isHome: z.boolean(),
  competitionName: z.string().nullable(),
  matchTime: z.string().nullable(),
});

export const previewFixturesResponseSchema = z.object({
  fixtures: z.array(previewFixtureSchema),
});

// ── Notification schemas ──

export const notifyPreviewSchema = z.object({
  memberCategory: z.string().optional(),
  membershipStatus: z.enum(["active", "lapsed"]).optional(),
  additionalEmails: z.array(z.email()).optional(),
});

const recipientSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  source: z.enum(["filter", "manual"]),
});

export const notifyPreviewResponseSchema = z.object({
  recipients: z.array(recipientSchema),
});

export const notifySendSchema = z.object({
  recipients: z.array(
    z.object({
      email: z.email(),
      name: z.string().nullable(),
    }),
  ),
});

export const notifySendResponseSchema = z.object({
  sent: z.number(),
  failed: z.number(),
  failures: z.array(
    z.object({
      email: z.string(),
      reason: z.string(),
    }),
  ),
});

// ── Public request schema ──

export const getPublicRequestResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    date_from: z.string(),
    date_to: z.string(),
    status: z.string(),
  }),
  fixtures: z.array(activeFixtureSchema),
});

// ── Types ──

export type CreateRequest = z.infer<typeof createRequestSchema>;
export type AssignPlayer = z.infer<typeof assignPlayerSchema>;
export type SetAvailability = z.infer<typeof setAvailabilitySchema>;
export type Respond = z.infer<typeof respondSchema>;
export type UpdateRequestStatus = z.infer<typeof updateRequestStatusSchema>;
export type ListRequests = z.infer<typeof listRequestsSchema>;
export type NotifyPreview = z.infer<typeof notifyPreviewSchema>;
export type NotifySend = z.infer<typeof notifySendSchema>;
