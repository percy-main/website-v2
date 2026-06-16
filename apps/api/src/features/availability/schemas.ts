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

export const requestDateFixtureParamSchema = z.object({
  requestId: z.string(),
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  fixtureId: z.string(),
});

export const requestDateMemberParamSchema = z.object({
  requestId: z.string(),
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  memberId: z.string(),
});

export const requestDateDependentParamSchema = z.object({
  requestId: z.string(),
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  dependentId: z.string(),
});

// ── Body schemas ──

export const createRequestSchema = z.object({
  dateFrom: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  dateTo: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  userGroupIds: z.array(z.string()).min(1),
  additionalEmails: z.array(z.email()).optional(),
});

export const previewRangeSchema = z.object({
  dateFrom: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
  dateTo: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD format"),
});

export const assignPlayerSchema = z
  .object({
    fixtureId: z.string(),
    memberId: z.string().optional(),
    // A junior dependent (no member row) picked to play up into a senior
    // squad. Mutually exclusive with memberId; the guest path supplies
    // neither and relies on playerName alone.
    dependentId: z.string().optional(),
    playerName: z.string().min(1),
  })
  .refine((d) => !(d.memberId && d.dependentId), {
    message: "Cannot assign both a member and a dependent",
    path: ["dependentId"],
  });

export const setAvailabilitySchema = z.object({
  status: z.enum(["available", "unavailable"]),
});

export const respondSchema = z.object({
  // When set, the parent is answering on behalf of one of their junior
  // dependents (omit to answer for themselves). The dependent must be
  // registered under the signed-in member.
  subjectDependentId: z.string().optional(),
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
  notify: z.object({
    sent: z.number(),
    failed: z.number(),
    recipientCount: z.number(),
  }),
});

const requestItemFixtureSchema = z.object({
  id: z.string(),
  match_date: z.string(),
  opposition: z.string(),
  is_home: z.boolean(),
  team_name: z.string().nullable(),
  competition_name: z.string().nullable(),
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
  fixtures: z.array(requestItemFixtureSchema),
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
  team_name: z.string().nullable(),
});

const dateEntrySchema = z.object({
  date: z.string(),
  fixtures: z.array(fixtureSchema),
  responseCount: z.number(),
  assignmentCount: z.number(),
  // Number of this date's fixtures that already have a (non-cancelled)
  // matchday - i.e. teams confirmed individually without closing the
  // whole request. Drives the per-date "confirmed" indicator.
  confirmedCount: z.number(),
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
  dependent_id: z.string().nullable(),
  player_name: z.string(),
  position: z.number(),
  created_at: z.string(),
});

// A respondent in the date-detail pools. Exactly one of member_id /
// dependent_id is set: a member answering for themselves, or a junior
// dependent a parent answered for. `member_name` carries the subject's
// display name in both cases.
const responseItemSchema = z.object({
  id: z.string(),
  member_id: z.string().nullable(),
  dependent_id: z.string().nullable(),
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
  // Set once this fixture's team has been confirmed into a matchday
  // (per-fixture confirm, or on request close). Null while the picks are
  // still provisional. Drives the "Confirm team" vs "Manage squad" CTA.
  matchdayId: z.string().nullable(),
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
  assignedDependentIds: z.array(z.string()),
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

export const confirmFixtureResponseSchema = z.object({
  matchdayId: z.string(),
});

export const updateRequestStatusResponseSchema = z.object({
  success: z.boolean(),
  // Number of matchdays auto-created when the request flipped to
  // "closed". Always 0 when re-opening or when no date had assignments.
  matchdaysCreated: z.number(),
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

// A dependent's existing answer to a request, used to pre-fill the
// per-dependent step of the answering wizard.
const dependentResponseSchema = z.object({
  dependent_id: z.string(),
  match_date: z.string(),
  status: z.string(),
  note: z.string().nullable(),
});

const availableCountSchema = z.object({
  match_date: z.string(),
  count: z.number(),
});

export const getActiveRequestsResponseSchema = z.object({
  memberId: z.string().nullable(),
  // The signed-in member's junior dependents. The answering wizard lets a
  // parent answer for themselves plus each of these.
  dependents: z.array(z.object({ id: z.string(), name: z.string() })),
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
      dependentResponses: z.array(dependentResponseSchema),
      availableCounts: z.array(availableCountSchema),
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
export type NotifySend = z.infer<typeof notifySendSchema>;
