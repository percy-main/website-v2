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

// Bulk add — captains pick a batch of members at once. A single
// shape covers the one-at-a-time case (memberIds with length 1) so
// the API surface stays small.
export const addGroupMembersSchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1),
});
export type AddGroupMembers = z.infer<typeof addGroupMembersSchema>;

export const addGroupMembersResponseSchema = z.object({
  added: z.number().int().nonnegative(),
});

const successResponseSchema = z.object({ success: z.boolean() });
export const removeGroupMemberResponseSchema = successResponseSchema;

// ── Eligible members listing (for "Add member" modal) ──────────────────

// Returns every non-deleted member not already in the group. The
// client filters the list locally — a typeahead round-trip per
// keystroke is too slow when the captain wants to bulk-add.
export const availableMembersResponseSchema = z.object({
  members: z.array(
    z.object({
      memberId: z.string(),
      name: z.string().nullable(),
      email: z.string(),
    }),
  ),
});
