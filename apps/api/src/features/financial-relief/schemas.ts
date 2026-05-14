import {
  contactPreferenceSchema,
  contributionAbilitySchema,
  durationSchema,
  grantDecisionSchema,
  reasonCategorySchema,
  requestStatusSchema,
  volunteerOptionSchema,
} from "@percy-main/shared";
import { z } from "zod";

const successResponseSchema = z.object({ success: z.boolean() });
const idResponseSchema = z.object({ id: z.string() });

// --- Member-facing requests ----------------------------------------------

export const submitReliefRequestSchema = z
  .object({
    memberId: z.string().min(1),
    requestedMembershipFull: z.boolean(),
    requestedMembershipPartial: z.boolean(),
    requestedMatchFees: z.boolean(),
    partialAmountPence: z.number().int().nonnegative().nullable().optional(),
    reasonCategory: reasonCategorySchema.nullable().optional(),
    reasonText: z.string().max(2000).nullable().optional(),
    duration: durationSchema.nullable().optional(),
    durationOtherText: z.string().max(500).nullable().optional(),
    contributionAbility: contributionAbilitySchema.nullable().optional(),
    contributionAmountPence: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
    volunteerOptions: z.array(volunteerOptionSchema).default([]),
    volunteerNotes: z.string().max(2000).nullable().optional(),
    contactPreference: contactPreferenceSchema,
    privacyAcknowledged: z.literal(true),
    declarationConfirmed: z.literal(true),
  })
  .refine(
    (data) =>
      data.requestedMembershipFull ||
      data.requestedMembershipPartial ||
      data.requestedMatchFees,
    {
      message: "Select at least one type of support",
      path: ["requestedMatchFees"],
    },
  );

export type SubmitReliefRequest = z.infer<typeof submitReliefRequestSchema>;

export const withdrawRequestSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

// --- Params --------------------------------------------------------------

export const requestIdParamSchema = z.object({ requestId: z.string().min(1) });
export type RequestIdParam = z.infer<typeof requestIdParamSchema>;

export const grantIdParamSchema = z.object({ grantId: z.string().min(1) });
export type GrantIdParam = z.infer<typeof grantIdParamSchema>;

// --- Admin queries -------------------------------------------------------

export const listReliefRequestsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .union([requestStatusSchema, z.literal("all")])
    .default("all")
    .optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
export type ListReliefRequests = z.infer<typeof listReliefRequestsSchema>;

// --- Admin status transitions / decline ----------------------------------

export const transitionStatusSchema = z.object({
  toStatus: z.enum(["in_review", "more_info_needed"]),
  note: z.string().max(2000).nullable().optional(),
});
export type TransitionStatus = z.infer<typeof transitionStatusSchema>;

export const declineRequestSchema = z.object({
  memberFacingNote: z.string().max(2000).nullable().optional(),
  adminNote: z.string().max(2000).nullable().optional(),
});
export type DeclineRequest = z.infer<typeof declineRequestSchema>;

// --- Admin decide --------------------------------------------------------

export const decideReliefRequestSchema = z
  .object({
    decision: grantDecisionSchema,
    coversMembership: z.boolean(),
    coversMatchFees: z.boolean(),
    membershipPartialPence: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
    effectiveFrom: z.string().min(1), // ISO date
    effectiveToExclusive: z.string().nullable().optional(),
    adminNotes: z.string().max(4000).nullable().optional(),
    memberFacingNote: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => d.coversMembership || d.coversMatchFees, {
    message: "Approval must cover at least one of membership or match fees",
    path: ["coversMatchFees"],
  });
export type DecideReliefRequest = z.infer<typeof decideReliefRequestSchema>;

// --- Close grant ---------------------------------------------------------

export const closeGrantSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type CloseGrant = z.infer<typeof closeGrantSchema>;

// --- Apply membership relief --------------------------------------------

export const applyMembershipReliefSchema = z.object({
  amountPence: z.number().int().nonnegative(),
  effectiveDate: z.string().min(1), // ISO date for the synthetic charge
  membershipPaidUntil: z.string().min(1), // ISO date
  membershipType: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
});
export type ApplyMembershipRelief = z.infer<typeof applyMembershipReliefSchema>;

// --- Reporting -----------------------------------------------------------

export const reliefReportSchema = z.object({
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
});
export type ReliefReport = z.infer<typeof reliefReportSchema>;

// --- Response schemas ----------------------------------------------------

export const eligibleMembersResponseSchema = z.object({
  members: z.array(
    z.object({
      memberId: z.string(),
      name: z.string().nullable(),
      relationship: z.enum(["self", "junior"]),
    }),
  ),
});

const myRequestSummarySchema = z.object({
  id: z.string(),
  memberId: z.string(),
  memberName: z.string().nullable(),
  status: requestStatusSchema,
  requestedMembershipFull: z.boolean(),
  requestedMembershipPartial: z.boolean(),
  requestedMatchFees: z.boolean(),
  createdAt: z.string(),
  memberFacingNote: z.string().nullable(),
  activeGrant: z
    .object({
      decision: grantDecisionSchema,
      coversMembership: z.boolean(),
      coversMatchFees: z.boolean(),
      effectiveFrom: z.string(),
      effectiveToExclusive: z.string().nullable(),
    })
    .nullable(),
});

export const myReliefStatusResponseSchema = z.object({
  requests: z.array(myRequestSummarySchema),
});

const adminRequestRowSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  memberName: z.string().nullable(),
  memberEmail: z.string().nullable(),
  submittedByUserId: z.string(),
  submittedByName: z.string().nullable(),
  submittedByEmail: z.string(),
  status: requestStatusSchema,
  requestedMembershipFull: z.boolean(),
  requestedMembershipPartial: z.boolean(),
  requestedMatchFees: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
});

export const listReliefRequestsResponseSchema = z.object({
  items: z.array(adminRequestRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const eventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  note: z.string().nullable(),
  actorUserId: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

const grantDetailSchema = z.object({
  id: z.string(),
  decision: grantDecisionSchema,
  coversMembership: z.boolean(),
  coversMatchFees: z.boolean(),
  membershipPartialPence: z.number().nullable(),
  effectiveFrom: z.string(),
  effectiveToExclusive: z.string().nullable(),
  adminNotes: z.string().nullable(),
  memberFacingNote: z.string().nullable(),
  decidedBy: z.string(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string(),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
  closedReason: z.string().nullable(),
});

export const reliefRequestDetailResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    memberId: z.string(),
    memberName: z.string().nullable(),
    memberEmail: z.string().nullable(),
    submittedByUserId: z.string(),
    submittedByName: z.string().nullable(),
    submittedByEmail: z.string(),
    status: requestStatusSchema,
    requestedMembershipFull: z.boolean(),
    requestedMembershipPartial: z.boolean(),
    requestedMatchFees: z.boolean(),
    partialAmountPence: z.number().nullable(),
    reasonCategory: z.string().nullable(),
    reasonText: z.string().nullable(),
    duration: z.string().nullable(),
    durationOtherText: z.string().nullable(),
    contributionAbility: z.string().nullable(),
    contributionAmountPence: z.number().nullable(),
    volunteerOptions: z.array(z.string()),
    volunteerNotes: z.string().nullable(),
    contactPreference: z.string(),
    privacyAcknowledgedAt: z.string(),
    declarationConfirmedAt: z.string(),
    withdrawnAt: z.string().nullable(),
    withdrawnReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  events: z.array(eventSchema),
  grant: grantDetailSchema.nullable(),
});

export const submitReliefRequestResponseSchema = idResponseSchema;
export const transitionStatusResponseSchema = successResponseSchema;
export const declineRequestResponseSchema = successResponseSchema;
export const decideReliefRequestResponseSchema = z.object({
  grantId: z.string(),
  forgivenChargeCount: z.number(),
});
export const closeGrantResponseSchema = successResponseSchema;
export const withdrawRequestResponseSchema = successResponseSchema;
export const applyMembershipReliefResponseSchema = z.object({
  chargeId: z.string(),
});

export const reliefReportResponseSchema = z.object({
  totalForgivenPence: z.number(),
  byReliefType: z.object({
    membershipPence: z.number(),
    matchFeePence: z.number(),
  }),
  bySection: z.object({
    juniors: z.object({
      pence: z.number(),
      count: z.number(),
      members: z.number(),
    }),
    womensGirls: z.object({
      pence: z.number(),
      count: z.number(),
      members: z.number(),
    }),
    senior: z.object({
      pence: z.number(),
      count: z.number(),
      members: z.number(),
    }),
    other: z.object({
      pence: z.number(),
      count: z.number(),
      members: z.number(),
    }),
  }),
  membersSupported: z.number(),
  forgivenChargeCount: z.number(),
});
