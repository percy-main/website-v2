import { z } from "zod";

// ── Params ─────────────────────────────────────────────────────────────

export const groupIdParamSchema = z.object({
  groupId: z.string().min(1),
});

export const groupMemberParamSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
});

// ── Group listing ──────────────────────────────────────────────────────

const groupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const listGroupsResponseSchema = z.object({
  groups: z.array(groupSummarySchema),
});

// ── Group detail ───────────────────────────────────────────────────────

const groupMemberRowSchema = z.object({
  memberId: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  addedAt: z.string(),
});

export const getGroupResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  members: z.array(groupMemberRowSchema),
});

// ── Create ─────────────────────────────────────────────────────────────

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
});
export type CreateGroup = z.infer<typeof createGroupSchema>;

export const createGroupResponseSchema = z.object({
  id: z.string(),
});

// ── Add / remove members ───────────────────────────────────────────────

export const addGroupMemberSchema = z.object({
  memberId: z.string().min(1),
});
export type AddGroupMember = z.infer<typeof addGroupMemberSchema>;

const successResponseSchema = z.object({ success: z.boolean() });
export const addGroupMemberResponseSchema = successResponseSchema;
export const removeGroupMemberResponseSchema = successResponseSchema;

// ── User search (for "Add member" modal) ───────────────────────────────

export const searchUsersForGroupSchema = z.object({
  q: z.string().optional(),
});
export type SearchUsersForGroup = z.infer<typeof searchUsersForGroupSchema>;

export const searchUsersForGroupResponseSchema = z.object({
  users: z.array(
    z.object({
      memberId: z.string(),
      name: z.string().nullable(),
      email: z.string(),
    }),
  ),
});
