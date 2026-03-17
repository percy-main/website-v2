import { z } from "zod";

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
  userId: z.string(),
  name: z.string().optional(),
  email: z.string().email().optional(),
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
  email: z.string().email(),
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

export const contentfulLinkSchema = z.object({
  memberId: z.string(),
  contentfulEntryId: z.string(),
});

export const contentfulUnlinkSchema = z.object({
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
export type ContentfulLink = z.infer<typeof contentfulLinkSchema>;
export type ContentfulUnlink = z.infer<typeof contentfulUnlinkSchema>;
export type SetMemberCategory = z.infer<typeof setMemberCategorySchema>;
export type ArchiveMember = z.infer<typeof archiveMemberSchema>;
export type CreateCharge = z.infer<typeof createChargeSchema>;
export type DeleteCharge = z.infer<typeof deleteChargeSchema>;
export type SetJuniorManagerTeams = z.infer<typeof setJuniorManagerTeamsSchema>;
export type SetOfficialTeams = z.infer<typeof setOfficialTeamsSchema>;
