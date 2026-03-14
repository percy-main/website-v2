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
  role: z.string().nullable().optional(),
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

export type ListUsers = z.infer<typeof listUsersSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type ChargeNotification = z.infer<typeof chargeNotificationSchema>;
export type CreateMember = z.infer<typeof createMemberSchema>;
export type RecordLinking = z.infer<typeof recordLinkingSchema>;
export type Unlink = z.infer<typeof unlinkSchema>;
export type ContentfulLink = z.infer<typeof contentfulLinkSchema>;
export type ContentfulUnlink = z.infer<typeof contentfulUnlinkSchema>;
