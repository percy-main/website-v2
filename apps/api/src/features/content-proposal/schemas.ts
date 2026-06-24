import {
  contentProposalStatusSchema,
  personPhotoSchema,
} from "@percy-main/shared/content";
import { z } from "zod";
import { contentBodyTransportSchema } from "../content/schemas.ts";

// ── Self-editable profile slice ─────────────────────────────────────────
//
// Only the bio (body) and photo are self-editable; title/slug and the
// safeguarding flags stay admin-only, so a proposal carries exactly these
// two fields. The body uses the depth-1 transport schema (the recursive
// shared schema can't be expressed for openapi-typescript); the service
// re-validates the full tree, exactly as the content feature does. photo
// null means "remove my photo".

const profileEditFieldsSchema = z.object({
  body: contentBodyTransportSchema,
  photo: personPhotoSchema.nullable(),
});

// ── Owner: read edit state + submit ─────────────────────────────────────

/**
 * The logged-in member's profile-edit state. `profile` is null when the
 * caller has no slug-linked person profile (so the UI shows nothing to
 * edit). `contentId` is null for a slug-linked member whose profile page
 * does not exist yet - a "virtual" profile they can author, created on
 * first submit. `pendingProposal` is the one open proposal awaiting review,
 * if any - while it exists the owner cannot submit another.
 */
export const profileEditStateResponseSchema = z.object({
  profile: z
    .object({
      contentId: z.string().nullable(),
      slug: z.string(),
      title: z.string(),
      body: contentBodyTransportSchema,
      photo: personPhotoSchema.nullable(),
    })
    .nullable(),
  pendingProposal: z
    .object({
      id: z.string(),
      body: contentBodyTransportSchema,
      photo: personPhotoSchema.nullable(),
      createdAt: z.string(),
    })
    .nullable(),
});

export const submitProposalSchema = profileEditFieldsSchema;

export const submitProposalResponseSchema = z.object({
  id: z.string(),
  status: contentProposalStatusSchema,
});

// ── Reviewer: queue + decisions ─────────────────────────────────────────

export const proposalIdParamSchema = z.object({
  proposalId: z.uuid(),
});

/** One row in the reviewer's pending-proposals queue. */
export const listProposalsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      contentId: z.string(),
      slug: z.string(),
      title: z.string(),
      proposedBy: z.string(),
      proposedByName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

/**
 * A single proposal in full for the review screen: the proposed bio/photo
 * alongside the live ones, so the reviewer can compare before deciding.
 */
export const proposalDetailResponseSchema = z.object({
  id: z.string(),
  contentId: z.string(),
  slug: z.string(),
  title: z.string(),
  status: contentProposalStatusSchema,
  proposedBy: z.string(),
  proposedByName: z.string().nullable(),
  createdAt: z.string(),
  proposed: z.object({
    body: contentBodyTransportSchema,
    photo: personPhotoSchema.nullable(),
  }),
  current: z.object({
    body: contentBodyTransportSchema,
    photo: personPhotoSchema.nullable(),
  }),
});

export const rejectProposalSchema = z
  .object({
    /** Why it was rejected - carried back to the proposer in the email. */
    note: z.string().min(1).max(2000).optional(),
  })
  // Optional so a bare reject (no note) needs no request body.
  .optional();

export const proposalIdResponseSchema = z.object({
  id: z.string(),
  status: contentProposalStatusSchema,
});
