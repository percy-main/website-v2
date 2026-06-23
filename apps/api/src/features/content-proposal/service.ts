import type { DB } from "@percy-main/db";
import {
  ProfileEditDecision,
  ProfileEditProposalSubmitted,
  type Email,
} from "@percy-main/email";
import { checkPermission } from "@percy-main/shared/auth/permissions";
import {
  contentBodySchema,
  personMetadataSchema,
  personPhotoSchema,
  type PersonPhoto,
} from "@percy-main/shared/content";
import type { FastifyBaseLogger } from "fastify";
import { sql, type Kysely } from "kysely";
import { createElement } from "react";
import { render } from "react-email";
import { z } from "zod";
import { writeRevision } from "../content/service.ts";

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

/** Validate an incoming body is a structurally sound BlockNote block array. */
function parseBody(body: unknown) {
  const result = contentBodySchema.safeParse(body);
  if (!result.success) {
    throwHttpError(400, "Body is not a valid block document");
  }
  return result.data;
}

/**
 * Parse a stored body for a read response. A stored body failing the schema
 * is a server-side data problem (500), not a bad request - the same stance
 * as the content feature's getContent/getRevision.
 */
function parseStoredBody(body: unknown) {
  const result = contentBodySchema.safeParse(body);
  if (!result.success) {
    throwHttpError(500, "Stored body does not match the block schema");
  }
  return result.data;
}

/** The photo-only metadata subset a proposal stores ({} or { photo }). */
const proposedMetadataSchema = z.object({
  photo: personPhotoSchema.optional(),
});

interface NotifyDeps {
  baseUrl: string;
  send: (email: Email) => Promise<void>;
  log: FastifyBaseLogger;
}

// ── Eligibility resolver ────────────────────────────────────────────────
//
// user.email -> member (paired by email at sign-up) -> member.slug ->
// person content_item. A caller whose member has no slug (the admin hasn't
// linked them in the Record Linking tab) simply has no self-editable
// profile - eligibility falls out of the existing link, no opt-in flag.

interface EditableProfile {
  contentId: string;
  slug: string;
  title: string;
  body: unknown;
  photo: PersonPhoto | null;
}

async function resolveEditableProfile(
  db: Kysely<DB>,
  userEmail: string,
): Promise<EditableProfile | null> {
  const member = await db
    .selectFrom("member")
    .where("email", "=", userEmail)
    .where("deleted_at", "is", null)
    .where("slug", "is not", null)
    .select(["slug"])
    .executeTakeFirst();
  if (!member?.slug) return null;

  const person = await db
    .selectFrom("content_item")
    .where("kind", "=", "person")
    .where("slug", "=", member.slug)
    .select(["id", "slug", "title", "body", "metadata"])
    .executeTakeFirst();
  if (!person) return null;

  // A stored profile failing its schema is a server-side data problem; fall
  // back to "no photo" rather than blocking the owner from editing their bio.
  const meta = personMetadataSchema.safeParse(person.metadata);
  return {
    contentId: person.id,
    slug: person.slug,
    title: person.title,
    body: person.body,
    photo: meta.success ? (meta.data.photo ?? null) : null,
  };
}

// ── Reviewer set ────────────────────────────────────────────────────────
//
// "All content editors who can publish people" - the approver pool. The
// role column is a comma-separated list SQL can't resolve to grants, so we
// narrow to non-banned users with a role string and confirm each with
// checkPermission (the listOfficials pattern). The proposer is excluded so
// an editor editing their own profile isn't asked to review it.

async function listProfileReviewers(
  db: Kysely<DB>,
  excludeUserId: string,
): Promise<Array<{ id: string; email: string; name: string }>> {
  const rows = await db
    .selectFrom("user")
    .where("id", "!=", excludeUserId)
    .where("role", "is not", null)
    .where("role", "!=", "")
    .where((eb) => eb.or([eb("banned", "is", null), eb("banned", "=", false)]))
    .select(["id", "name", "email", "role"])
    .orderBy("name", "asc")
    .execute();
  return rows
    .filter((r) => checkPermission(r.role, "content_people", "publish"))
    .map((r) => ({ id: r.id, email: r.email, name: r.name }));
}

// ── Owner: read edit state ──────────────────────────────────────────────

export function getProfileEditState(db: Kysely<DB>) {
  return async (userEmail: string) => {
    const profile = await resolveEditableProfile(db, userEmail);
    if (!profile) {
      return { profile: null, pendingProposal: null };
    }

    const pending = await db
      .selectFrom("content_proposal")
      .where("content_id", "=", profile.contentId)
      .where("status", "=", "pending")
      .select(["id", "proposed_body", "proposed_metadata", "created_at"])
      .executeTakeFirst();

    return {
      profile: {
        contentId: profile.contentId,
        slug: profile.slug,
        title: profile.title,
        body: parseStoredBody(profile.body),
        photo: profile.photo,
      },
      pendingProposal: pending
        ? {
            id: pending.id,
            body: parseStoredBody(pending.proposed_body),
            photo:
              proposedMetadataSchema.safeParse(pending.proposed_metadata).data
                ?.photo ?? null,
            createdAt: pending.created_at.toISOString(),
          }
        : null,
    };
  };
}

// ── Owner: submit a proposal ────────────────────────────────────────────

export function submitProfileProposal(db: Kysely<DB>, deps: NotifyDeps) {
  return async (params: {
    userId: string;
    userEmail: string;
    body: unknown;
    photo: PersonPhoto | null;
  }) => {
    const profile = await resolveEditableProfile(db, params.userEmail);
    if (!profile) {
      throwHttpError(403, "You do not have a profile you can edit");
    }

    const body = parseBody(params.body);
    const proposedMetadata = params.photo ? { photo: params.photo } : {};

    const proposalId = await db.transaction().execute(async (tx) => {
      // One open proposal per profile: block a second while one is pending.
      // The partial unique index is the backstop against a race; this is the
      // friendly 409.
      const existing = await tx
        .selectFrom("content_proposal")
        .select("id")
        .where("content_id", "=", profile.contentId)
        .where("status", "=", "pending")
        .executeTakeFirst();
      if (existing) {
        throwHttpError(
          409,
          "You already have an edit awaiting review - it must be approved or rejected before you can submit another",
        );
      }

      const row = await tx
        .insertInto("content_proposal")
        .values({
          content_id: profile.contentId,
          proposed_body: JSON.stringify(body),
          proposed_metadata: JSON.stringify(proposedMetadata),
          proposed_by: params.userId,
          status: "pending",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    });

    // Notify every content publisher (excluding the proposer) so any of them
    // can review. Best-effort: a mail failure must not roll back the
    // proposal, mirroring the matchday/financial-relief notifiers.
    try {
      const reviewers = await listProfileReviewers(db, params.userId);
      const reviewUrl = `${deps.baseUrl}/admin`;
      await Promise.all(
        reviewers.map(async (reviewer) => {
          const html = await render(
            createElement(ProfileEditProposalSubmitted.component, {
              imageBaseUrl: `${deps.baseUrl}/images`,
              recipientName: reviewer.name,
              profileName: profile.title,
              reviewUrl,
            }),
          );
          await deps.send({
            to: reviewer.email,
            subject: ProfileEditProposalSubmitted.subject,
            html,
          });
        }),
      );
    } catch (err) {
      deps.log.error(
        { err, contentId: profile.contentId },
        "profile_proposal_reviewer_notification_failed",
      );
    }

    return { id: proposalId, status: "pending" as const };
  };
}

// ── Reviewer: queue ─────────────────────────────────────────────────────

export function listPendingProposals(db: Kysely<DB>) {
  return async () => {
    const rows = await db
      .selectFrom("content_proposal")
      .innerJoin(
        "content_item",
        "content_item.id",
        "content_proposal.content_id",
      )
      .leftJoin(
        "user as proposer",
        "proposer.id",
        "content_proposal.proposed_by",
      )
      .where("content_proposal.status", "=", "pending")
      .select([
        "content_proposal.id",
        "content_proposal.content_id",
        "content_item.slug",
        "content_item.title",
        "content_proposal.proposed_by",
        "proposer.name as proposed_by_name",
        "content_proposal.created_at",
      ])
      .orderBy("content_proposal.created_at", "asc")
      .execute();

    return {
      items: rows.map((r) => ({
        id: r.id,
        contentId: r.content_id,
        slug: r.slug,
        title: r.title,
        proposedBy: r.proposed_by,
        proposedByName: r.proposed_by_name,
        createdAt: r.created_at.toISOString(),
      })),
    };
  };
}

export function getProposalDetail(db: Kysely<DB>) {
  return async (proposalId: string) => {
    const row = await db
      .selectFrom("content_proposal")
      .innerJoin(
        "content_item",
        "content_item.id",
        "content_proposal.content_id",
      )
      .leftJoin(
        "user as proposer",
        "proposer.id",
        "content_proposal.proposed_by",
      )
      .where("content_proposal.id", "=", proposalId)
      .select([
        "content_proposal.id",
        "content_proposal.content_id",
        "content_proposal.status",
        "content_proposal.proposed_by",
        "proposer.name as proposed_by_name",
        "content_proposal.proposed_body",
        "content_proposal.proposed_metadata",
        "content_proposal.created_at",
        "content_item.slug",
        "content_item.title",
        "content_item.body as current_body",
        "content_item.metadata as current_metadata",
      ])
      .executeTakeFirst();
    if (!row) throwHttpError(404, "Proposal not found");

    const proposedBody = contentBodySchema.safeParse(row.proposed_body);
    const currentBody = contentBodySchema.safeParse(row.current_body);
    if (!proposedBody.success || !currentBody.success) {
      throwHttpError(500, "Stored body does not match the block schema");
    }
    const currentMeta = personMetadataSchema.safeParse(row.current_metadata);

    return {
      id: row.id,
      contentId: row.content_id,
      slug: row.slug,
      title: row.title,
      status: row.status as "pending" | "approved" | "rejected",
      proposedBy: row.proposed_by,
      proposedByName: row.proposed_by_name,
      createdAt: row.created_at.toISOString(),
      proposed: {
        body: proposedBody.data,
        photo:
          proposedMetadataSchema.safeParse(row.proposed_metadata).data?.photo ??
          null,
      },
      current: {
        body: currentBody.data,
        photo: currentMeta.success ? (currentMeta.data.photo ?? null) : null,
      },
    };
  };
}

// ── Reviewer: approve ───────────────────────────────────────────────────

export function approveProfileProposal(db: Kysely<DB>, deps: NotifyDeps) {
  return async (params: { proposalId: string; reviewerUserId: string }) => {
    const decision = await db.transaction().execute(async (tx) => {
      const proposal = await tx
        .selectFrom("content_proposal")
        .innerJoin(
          "content_item",
          "content_item.id",
          "content_proposal.content_id",
        )
        .leftJoin(
          "user as proposer",
          "proposer.id",
          "content_proposal.proposed_by",
        )
        .where("content_proposal.id", "=", params.proposalId)
        .select([
          "content_proposal.status",
          "content_proposal.content_id",
          "content_proposal.proposed_body",
          "content_proposal.proposed_metadata",
          "proposer.email as proposer_email",
          "proposer.name as proposer_name",
          "content_item.kind",
          "content_item.slug",
          "content_item.title",
          "content_item.description",
          "content_item.metadata as current_metadata",
        ])
        .executeTakeFirst();
      if (!proposal) throwHttpError(404, "Proposal not found");
      if (proposal.status !== "pending") {
        throwHttpError(409, "This proposal has already been reviewed");
      }
      if (proposal.kind !== "person") {
        throwHttpError(409, "Only person profiles can be self-edited");
      }

      const body = parseBody(proposal.proposed_body);
      const proposedMeta = proposedMetadataSchema.parse(
        proposal.proposed_metadata,
      );
      const currentMeta = personMetadataSchema.parse(proposal.current_metadata);

      // Merge the photo onto the live metadata; the safeguarding flags
      // (isDBSChecked / hasLeftClub) are never self-editable, so they pass
      // through untouched. An absent proposed photo removes it.
      const newMetadata = {
        isDBSChecked: currentMeta.isDBSChecked,
        hasLeftClub: currentMeta.hasLeftClub,
        ...(proposedMeta.photo ? { photo: proposedMeta.photo } : {}),
      };

      await tx
        .updateTable("content_item")
        .set({
          body: JSON.stringify(body),
          metadata: JSON.stringify(newMetadata),
          updated_by: params.reviewerUserId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where("id", "=", proposal.content_id)
        .execute();

      // An approved proposal is just another save: snapshot it like any
      // content edit so the profile's history is complete.
      await writeRevision(
        tx,
        {
          id: proposal.content_id,
          title: proposal.title,
          description: proposal.description,
          body,
          metadata: newMetadata,
        },
        params.reviewerUserId,
      );

      // Guarded status flip: only the transaction that flips pending->approved
      // wins, so a concurrent approve/reject of the same proposal gets the 409.
      const marked = await tx
        .updateTable("content_proposal")
        .set({
          status: "approved",
          reviewed_by: params.reviewerUserId,
          reviewed_at: sql`CURRENT_TIMESTAMP`,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where("id", "=", params.proposalId)
        .where("status", "=", "pending")
        .returning("id")
        .executeTakeFirst();
      if (!marked)
        throwHttpError(409, "This proposal has already been reviewed");

      return {
        proposerEmail: proposal.proposer_email,
        proposerName: proposal.proposer_name,
        profileName: proposal.title,
        slug: proposal.slug,
      };
    });

    await notifyProposerOfDecision(deps, {
      to: decision.proposerEmail,
      recipientName: decision.proposerName,
      profileName: decision.profileName,
      outcome: "approved",
      decisionNote: null,
      slug: decision.slug,
    });

    return { id: params.proposalId, status: "approved" as const };
  };
}

// ── Reviewer: reject ────────────────────────────────────────────────────

export function rejectProfileProposal(db: Kysely<DB>, deps: NotifyDeps) {
  return async (params: {
    proposalId: string;
    reviewerUserId: string;
    note?: string;
  }) => {
    const decision = await db.transaction().execute(async (tx) => {
      const proposal = await tx
        .selectFrom("content_proposal")
        .innerJoin(
          "content_item",
          "content_item.id",
          "content_proposal.content_id",
        )
        .leftJoin(
          "user as proposer",
          "proposer.id",
          "content_proposal.proposed_by",
        )
        .where("content_proposal.id", "=", params.proposalId)
        .select([
          "content_proposal.status",
          "proposer.email as proposer_email",
          "proposer.name as proposer_name",
          "content_item.slug",
          "content_item.title",
        ])
        .executeTakeFirst();
      if (!proposal) throwHttpError(404, "Proposal not found");
      if (proposal.status !== "pending") {
        throwHttpError(409, "This proposal has already been reviewed");
      }

      const marked = await tx
        .updateTable("content_proposal")
        .set({
          status: "rejected",
          reviewed_by: params.reviewerUserId,
          reviewed_at: sql`CURRENT_TIMESTAMP`,
          decision_note: params.note ?? null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where("id", "=", params.proposalId)
        .where("status", "=", "pending")
        .returning("id")
        .executeTakeFirst();
      if (!marked)
        throwHttpError(409, "This proposal has already been reviewed");

      return {
        proposerEmail: proposal.proposer_email,
        proposerName: proposal.proposer_name,
        profileName: proposal.title,
        slug: proposal.slug,
      };
    });

    await notifyProposerOfDecision(deps, {
      to: decision.proposerEmail,
      recipientName: decision.proposerName,
      profileName: decision.profileName,
      outcome: "rejected",
      decisionNote: params.note ?? null,
      slug: decision.slug,
    });

    return { id: params.proposalId, status: "rejected" as const };
  };
}

/**
 * Email the proposer their decision (approve or reject). Best-effort: a
 * mail failure must not undo the committed review. A proposer always has a
 * user row (they were authenticated to submit), but email may be missing on
 * a malformed account, so guard.
 */
async function notifyProposerOfDecision(
  deps: NotifyDeps,
  params: {
    to: string | null;
    recipientName: string | null;
    profileName: string;
    outcome: "approved" | "rejected";
    decisionNote: string | null;
    slug: string;
  },
): Promise<void> {
  if (!params.to) return;
  try {
    const html = await render(
      createElement(ProfileEditDecision.component, {
        imageBaseUrl: `${deps.baseUrl}/images`,
        recipientName: params.recipientName ?? "there",
        profileName: params.profileName,
        outcome: params.outcome,
        decisionNote: params.decisionNote,
        profileUrl: `${deps.baseUrl}/person/${params.slug}`,
      }),
    );
    await deps.send({
      to: params.to,
      subject: ProfileEditDecision.subject,
      html,
    });
  } catch (err) {
    deps.log.error(
      { err, outcome: params.outcome },
      "profile_proposal_decision_notification_failed",
    );
  }
}
