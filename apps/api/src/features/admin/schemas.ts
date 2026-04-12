import { AGE_GROUPS } from "@percy-main/shared";
import { z } from "zod";

// --- Shared response helpers ---

const successResponseSchema = z.object({ success: z.boolean() });

const idResponseSchema = z.object({ id: z.string() });

const chargeStatusSchema = z.enum([
  "paid",
  "pending",
  "unpaid",
  "abandoned",
  "deleted",
]);

// --- Request schemas ---

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  includeArchived: z.coerce.boolean().default(false),
  isMember: z.coerce.boolean().optional(),
  membershipStatus: z.enum(["active", "lapsed", "none"]).optional(),
  membershipType: z.string().optional(),
  memberCategory: z.string().optional(),
  role: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().optional(),
  email: z.email().optional(),
  role: z
    .enum(["user", "admin", "junior_manager", "official"])
    .nullable()
    .optional(),
  banned: z.boolean().optional(),
  banReason: z.string().optional(),
});

export const chargeNotificationSchema = z.object({
  userId: z.string(),
});

export const createMemberSchema = z.object({
  email: z.email(),
  name: z.string().optional(),
  title: z.string().optional(),
  memberCategory: z.string().optional(),
});

export const recordLinkingSchema = z.object({
  type: z.enum(["member", "dependent"]),
  id: z.string(),
  playCricketId: z.string(),
});

export const unlinkSchema = z.object({
  type: z.enum(["member", "dependent"]),
  id: z.string(),
});

export const slugLinkSchema = z.object({
  memberId: z.string(),
  slug: z.string(),
});

export const slugUnlinkSchema = z.object({
  memberId: z.string(),
});

export const userIdParamSchema = z.object({
  userId: z.string(),
});

export const setMemberCategorySchema = z.object({
  memberCategory: z.string().nullable(),
});

export const archiveMemberSchema = z.object({
  reason: z.string().min(1),
});

export const createChargeSchema = z.object({
  description: z.string().min(1),
  amountPence: z.number().int().positive(),
  chargeDate: z.string(),
});

export const chargeIdParamSchema = z.object({
  chargeId: z.string(),
});

export const deleteChargeSchema = z.object({
  reason: z.string().min(1),
});

export const setJuniorManagerTeamsSchema = z.object({
  teamIds: z.array(z.string()),
});

export const setOfficialTeamsSchema = z.object({
  teamIds: z.array(z.string()),
});

export type ListUsers = z.infer<typeof listUsersSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type ChargeNotification = z.infer<typeof chargeNotificationSchema>;
export type CreateMember = z.infer<typeof createMemberSchema>;
export type RecordLinking = z.infer<typeof recordLinkingSchema>;
export type Unlink = z.infer<typeof unlinkSchema>;
export type SlugLink = z.infer<typeof slugLinkSchema>;
export type SlugUnlink = z.infer<typeof slugUnlinkSchema>;
export type SetMemberCategory = z.infer<typeof setMemberCategorySchema>;
export type ArchiveMember = z.infer<typeof archiveMemberSchema>;
export type CreateCharge = z.infer<typeof createChargeSchema>;
export type DeleteCharge = z.infer<typeof deleteChargeSchema>;
export type SetJuniorManagerTeams = z.infer<typeof setJuniorManagerTeamsSchema>;
export type SetOfficialTeams = z.infer<typeof setOfficialTeamsSchema>;

export const listChargesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(["all", "unpaid", "pending", "paid", "abandoned"])
    .default("all"),
  showDeleted: z.coerce.boolean().default(false),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

export const chargeAggregatesSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const chasePaymentSchema = z.object({
  chargeId: z.string(),
});

export type ListCharges = z.infer<typeof listChargesSchema>;
export type ChargeAggregates = z.infer<typeof chargeAggregatesSchema>;
export type ChasePayment = z.infer<typeof chasePaymentSchema>;

export const listJuniorsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  search: z.string().optional(),
  sex: z.enum(["all", "male", "female"]).default("all"),
  ageGroup: z.enum(["all", ...AGE_GROUPS]).default("all"),
  membershipStatus: z.enum(["all", "paid", "unpaid"]).default("all"),
});

export const searchUsersForLinkingSchema = z.object({
  dependentId: z.string().min(1),
  search: z.string().optional(),
});

export const linkDependentSchema = z.object({
  dependentId: z.string().min(1),
  userId: z.string().min(1),
});

export const unlinkDependentSchema = z.object({
  dependentId: z.string().min(1),
});

export const listContactSubmissionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export const mergePreviewSchema = z.object({
  keepMemberId: z.string().min(1),
  removeMemberId: z.string().min(1),
});

export const mergeMembersSchema = z.object({
  keepMemberId: z.string().min(1),
  removeMemberId: z.string().min(1),
});

export type ListContactSubmissions = z.infer<
  typeof listContactSubmissionsSchema
>;
export type ListJuniors = z.infer<typeof listJuniorsSchema>;
export type SearchUsersForLinking = z.infer<typeof searchUsersForLinkingSchema>;
export type LinkDependent = z.infer<typeof linkDependentSchema>;
export type UnlinkDependent = z.infer<typeof unlinkDependentSchema>;
export type MergePreview = z.infer<typeof mergePreviewSchema>;
export type MergeMembers = z.infer<typeof mergeMembersSchema>;

export const addMatchFeeRateSchema = z.object({
  playCricketTeamId: z.string().optional(),
  competitionType: z.string().optional(),
  memberCategory: z.string(),
  amountPence: z.number().int().min(0),
});

export const rateIdParamSchema = z.object({
  rateId: z.string(),
});

export type AddMatchFeeRate = z.infer<typeof addMatchFeeRateSchema>;
export type RateIdParam = z.infer<typeof rateIdParamSchema>;

// --- Game Reports schemas ---

export const listGameReportsSchema = z.object({
  teamId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const matchdayIdParamSchema = z.object({
  matchdayId: z.string(),
});

export type ListGameReports = z.infer<typeof listGameReportsSchema>;
export type MatchdayIdParam = z.infer<typeof matchdayIdParamSchema>;

// --- Response schemas ---

export const listUsersResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.string().nullable(),
      banned: z.boolean().nullable(),
      emailVerified: z.boolean(),
      createdAt: z.date(),
      memberId: z.string().nullable(),
      member_category: z.string().nullable(),
      memberDeletedAt: z.string().nullable(),
      memberDeletedReason: z.string().nullable(),
      membershipType: z.string().nullable(),
      membershipPaidUntil: z.string().nullable(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const updateUserResponseSchema = successResponseSchema;

export const getUserDetailResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string().nullable(),
    banned: z.boolean().nullable(),
    emailVerified: z.boolean(),
    createdAt: z.date(),
  }),
  member: z
    .object({
      id: z.string(),
      email: z.string(),
      name: z.string().nullable(),
      title: z.string().nullable(),
      address: z.string().nullable(),
      postcode: z.string().nullable(),
      dob: z.string().nullable(),
      telephone: z.string().nullable(),
      member_category: z.string().nullable(),
      play_cricket_id: z.string().nullable(),
      slug: z.string().nullable(),
      stripe_customer_id: z.string().nullable(),
      deleted_at: z.string().nullable(),
      deleted_by: z.string().nullable(),
      deleted_reason: z.string().nullable(),
      emergency_contact_name: z.string().nullable(),
      emergency_contact_telephone: z.string().nullable(),
    })
    .nullable(),
  membership: z
    .object({
      id: z.string(),
      member_id: z.string(),
      type: z.string().nullable(),
      paid_until: z.string(),
      dependent_id: z.string().nullable(),
      created_at: z.string(),
    })
    .nullable(),
  dependents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      dob: z.string(),
      sex: z.string(),
      school_year: z.string().nullable(),
      photo_consent: z.boolean().nullable(),
      gp_surgery: z.string().nullable(),
      gp_phone: z.string().nullable(),
      alt_contact_name: z.string().nullable(),
      alt_contact_phone: z.string().nullable(),
      emergency_medical_consent: z.boolean().nullable(),
      has_disability: z.boolean().nullable(),
      disability_type: z.string().nullable(),
      medical_info: z.string().nullable(),
      membershipPaidUntil: z.string().nullable(),
    }),
  ),
  charges: z.array(
    z.object({
      id: z.string(),
      member_id: z.string(),
      description: z.string(),
      amount_pence: z.number(),
      charge_date: z.string(),
      created_at: z.string(),
      created_by: z.string(),
      paid_at: z.string().nullable(),
      payment_confirmed_at: z.string().nullable(),
      payment_method: z.string().nullable(),
      stripe_payment_intent_id: z.string().nullable(),
      type: z.string(),
      source: z.string(),
      deleted_at: z.string().nullable(),
      deleted_by: z.string().nullable(),
      deleted_reason: z.string().nullable(),
    }),
  ),
  juniorManagerTeams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      age_group: z.string(),
      sex: z.string(),
    }),
  ),
  officialTeams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
});

export const setMemberCategoryResponseSchema = successResponseSchema;
export const archiveMemberResponseSchema = successResponseSchema;
export const restoreMemberResponseSchema = successResponseSchema;

export const createChargeResponseSchema = idResponseSchema;
export const deleteChargeResponseSchema = successResponseSchema;

export const setJuniorManagerTeamsResponseSchema = successResponseSchema;
export const setOfficialTeamsResponseSchema = successResponseSchema;

export const juniorTeamsResponseSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    age_group: z.string(),
    sex: z.string(),
    created_at: z.string(),
  }),
);

export const playCricketTeamsResponseSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    site_id: z.string(),
    is_junior: z.boolean(),
    last_updated: z.string().nullable(),
    created_at: z.string(),
  }),
);

export const playCricketPlayersResponseSchema = z.object({
  players: z.array(
    z.object({
      memberId: z.number(),
      name: z.string(),
    }),
  ),
});

export const createMemberResponseSchema = idResponseSchema;

export const chargeNotificationResponseSchema = z.object({
  sent: z.boolean(),
  reason: z.string().optional(),
  chargeCount: z.number().optional(),
});

export const recordLinkingResponseSchema = z.object({
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      play_cricket_id: z.string().nullable(),
      slug: z.string().nullable(),
    }),
  ),
  dependents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      play_cricket_id: z.string().nullable(),
      parentName: z.string().nullable(),
    }),
  ),
});

export const linkPlayCricketResponseSchema = successResponseSchema;
export const unlinkPlayCricketResponseSchema = successResponseSchema;
export const linkSlugResponseSchema = successResponseSchema;
export const unlinkSlugResponseSchema = successResponseSchema;

export const listChargesResponseSchema = z.object({
  charges: z.array(
    z.object({
      id: z.string(),
      memberId: z.string(),
      description: z.string(),
      amountPence: z.number(),
      chargeDate: z.string(),
      createdAt: z.string(),
      paidAt: z.string().nullable(),
      paymentConfirmedAt: z.string().nullable(),
      stripePaymentIntentId: z.string().nullable(),
      type: z.string(),
      source: z.string(),
      deletedAt: z.string().nullable(),
      deletedReason: z.string().nullable(),
      memberName: z.string().nullable(),
      memberEmail: z.string(),
      status: chargeStatusSchema,
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const chargeAggregatesResponseSchema = z.object({
  totalCharged: z.number(),
  totalPaid: z.number(),
  totalOutstanding: z.number(),
  totalAbandoned: z.number(),
  totalDeleted: z.number(),
  countPaid: z.number(),
  countUnpaid: z.number(),
  countPending: z.number(),
  countAbandoned: z.number(),
  countDeleted: z.number(),
});

export const chasePaymentResponseSchema = successResponseSchema;

export const listContactSubmissionsResponseSchema = z.object({
  submissions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      message: z.string(),
      page: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const listJuniorsResponseSchema = z.object({
  juniors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sex: z.string(),
      dob: z.string(),
      registeredAt: z.string(),
      parentName: z.string().nullable(),
      parentEmail: z.string(),
      parentTelephone: z.string().nullable(),
      paidUntil: z.string().nullable(),
      ageGroup: z.string().nullable(),
      teamName: z.string().nullable(),
      hasOwnAccount: z.boolean(),
      linkedUserEmail: z.string().nullable(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const searchUsersForLinkingResponseSchema = z.object({
  dependentName: z.string(),
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      score: z.number(),
    }),
  ),
});

export const linkDependentResponseSchema = successResponseSchema;
export const unlinkDependentResponseSchema = successResponseSchema;

const duplicateGroupMemberSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  title: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  membershipCount: z.number(),
  dependentCount: z.number(),
  chargeCount: z.number(),
});

export const findDuplicatesResponseSchema = z.object({
  groups: z.array(
    z.object({
      matchType: z.enum(["email", "name"]),
      matchKey: z.string(),
      members: z.array(duplicateGroupMemberSchema),
    }),
  ),
});

const mergePreviewMemberSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  email: z.string(),
  address: z.string().nullable(),
  postcode: z.string().nullable(),
  dob: z.string().nullable(),
  telephone: z.string().nullable(),
  stripe_customer_id: z.string().nullable(),
});

const mergePreviewSideSchema = z.object({
  member: mergePreviewMemberSchema,
  memberships: z.array(
    z.object({
      id: z.string(),
      type: z.string().nullable(),
      paid_until: z.string(),
    }),
  ),
  dependents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      dob: z.string(),
    }),
  ),
  charges: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      amount_pence: z.number(),
      paid_at: z.string().nullable(),
    }),
  ),
});

export const mergePreviewResponseSchema = z.object({
  isCrossEmailMerge: z.boolean(),
  keep: mergePreviewSideSchema,
  remove: mergePreviewSideSchema,
});

export const mergeMembersResponseSchema = successResponseSchema;

export const matchFeeRatesResponseSchema = z.object({
  rates: z.array(
    z.object({
      id: z.string(),
      play_cricket_team_id: z.string().nullable(),
      competition_type: z.string().nullable(),
      member_category: z.string(),
      amount_pence: z.number(),
      team_name: z.string().nullable(),
    }),
  ),
});

export const addMatchFeeRateResponseSchema = idResponseSchema;
export const deleteMatchFeeRateResponseSchema = successResponseSchema;

// --- Game Reports response schemas ---

export const listGameReportsResponseSchema = z.object({
  matchdays: z.array(
    z.object({
      id: z.string(),
      match_date: z.string(),
      opposition: z.string(),
      status: z.string(),
      play_cricket_team_id: z.string(),
      competition_type: z.string().nullable(),
      team_name: z.string().nullable(),
    }),
  ),
  total: z.number(),
});

export const matchdayReportResponseSchema = z.object({
  matchday: z.object({
    id: z.string(),
    match_date: z.string(),
    opposition: z.string(),
    status: z.string(),
    play_cricket_team_id: z.string(),
    play_cricket_match_id: z.string().nullable(),
    competition_type: z.string().nullable(),
    created_at: z.string(),
    created_by: z.string(),
    confirmed_at: z.string().nullable(),
    confirmed_by: z.string().nullable(),
    finished_at: z.string().nullable(),
    finished_by: z.string().nullable(),
    result_type: z.string().nullable(),
    result_source: z.string().nullable(),
    result_confirmed_at: z.string().nullable(),
    result_confirmed_by: z.string().nullable(),
  }),
  team: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
  players: z.array(
    z.object({
      id: z.string(),
      player_name: z.string(),
      status: z.string(),
      member_id: z.string().nullable(),
      member_category: z.string().nullable(),
      charge_amount_pence: z.number().nullable(),
      charge_paid_at: z.string().nullable(),
      charge_payment_method: z.string().nullable(),
      charge_deleted_at: z.string().nullable(),
      charge_payment_confirmed_at: z.string().nullable(),
      charge_stripe_payment_intent_id: z.string().nullable(),
      charge_created_at: z.string().nullable(),
      charge_status: chargeStatusSchema.nullable(),
    }),
  ),
  expenses: z.array(
    z.object({
      id: z.string(),
      matchday_id: z.string(),
      expense_type: z.string(),
      amount_pence: z.number(),
      description: z.string().nullable(),
      receipt_image_url: z.string().nullable(),
      status: z.string(),
      created_at: z.string(),
      created_by: z.string(),
      submitted_at: z.string().nullable(),
      approved_at: z.string().nullable(),
      approved_by: z.string().nullable(),
      rejected_reason: z.string().nullable(),
      reimbursed_at: z.string().nullable(),
      reimbursed_by: z.string().nullable(),
    }),
  ),
  sponsorship: z
    .object({
      id: z.string(),
      game_id: z.string(),
      sponsor_name: z.string(),
      sponsor_email: z.string(),
      sponsor_website: z.string().nullable(),
      sponsor_logo_url: z.string().nullable(),
      sponsor_message: z.string().nullable(),
      display_name: z.string().nullable(),
      amount_pence: z.number(),
      approved: z.boolean(),
      paid_at: z.string().nullable(),
      stripe_payment_intent_id: z.string().nullable(),
      notes: z.string().nullable(),
      created_at: z.string(),
    })
    .nullable(),
  summary: z.object({
    totalIncoming: z.number(),
    totalPaid: z.number(),
    totalPending: z.number(),
    totalOutstanding: z.number(),
    totalExpenses: z.number(),
    sponsorshipIncome: z.number(),
    profitLoss: z.number(),
  }),
});
