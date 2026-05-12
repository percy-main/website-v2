import type { DB } from "@percy-main/db";
import { FinancialReliefReceived, type Email } from "@percy-main/email";
import type { RequestStatus } from "@percy-main/shared";
import { render } from "@react-email/render";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { createElement } from "react";
import type {
  DeclineRequest,
  ListReliefRequests,
  SubmitReliefRequest,
  TransitionStatus,
  WithdrawRequest,
} from "./schemas.ts";

async function notImplemented(): Promise<never> {
  const err = new Error("Not implemented") as Error & { statusCode: number };
  err.statusCode = 501;
  await Promise.resolve();
  throw err;
}

function httpError(statusCode: number, message: string): never {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  throw err;
}

interface SubmitDeps {
  baseUrl: string;
  send: (email: Email) => Promise<void>;
}

/**
 * Resolves the set of member ids the caller is allowed to submit a relief
 * request for: their own member record (if any) plus any junior member they
 * are linked to via member_parent_link.
 */
export function getEligibleMembers(db: Kysely<DB>) {
  return async (callerUserEmail: string) => {
    const self = await db
      .selectFrom("member")
      .where("email", "=", callerUserEmail)
      .where("deleted_at", "is", null)
      .select(["id", "name"])
      .executeTakeFirst();

    const items: Array<{
      memberId: string;
      name: string | null;
      relationship: "self" | "junior";
    }> = [];

    if (self) {
      items.push({
        memberId: self.id,
        name: self.name,
        relationship: "self",
      });

      const juniors = await db
        .selectFrom("member_parent_link")
        .innerJoin("member", "member.id", "member_parent_link.member_id")
        .where("member_parent_link.parent_member_id", "=", self.id)
        .where("member.deleted_at", "is", null)
        .select(["member.id", "member.name"])
        .orderBy("member.name", "asc")
        .execute();

      for (const j of juniors) {
        items.push({
          memberId: j.id,
          name: j.name,
          relationship: "junior",
        });
      }
    }

    return { members: items };
  };
}

async function resolveCallerMemberIds(
  db: Kysely<DB>,
  email: string,
): Promise<{ selfMemberId: string; allowed: Set<string> }> {
  const self = await db
    .selectFrom("member")
    .where("email", "=", email)
    .where("deleted_at", "is", null)
    .select(["id"])
    .executeTakeFirst();
  if (!self) httpError(403, "No member record found for this account");

  const juniors = await db
    .selectFrom("member_parent_link")
    .innerJoin("member", "member.id", "member_parent_link.member_id")
    .where("member_parent_link.parent_member_id", "=", self.id)
    .where("member.deleted_at", "is", null)
    .select(["member.id"])
    .execute();

  return {
    selfMemberId: self.id,
    allowed: new Set([self.id, ...juniors.map((j) => j.id)]),
  };
}

export function submitReliefRequest(db: Kysely<DB>, deps: SubmitDeps) {
  return async (
    userId: string,
    userEmail: string,
    data: SubmitReliefRequest,
    log: FastifyBaseLogger,
  ) => {
    const { allowed } = await resolveCallerMemberIds(db, userEmail);
    if (!allowed.has(data.memberId)) {
      httpError(
        403,
        "You can only request relief for yourself or a linked junior",
      );
    }

    const targetMember = await db
      .selectFrom("member")
      .where("id", "=", data.memberId)
      .where("deleted_at", "is", null)
      .select(["id", "email", "name"])
      .executeTakeFirst();
    if (!targetMember) httpError(404, "Member not found");

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db
        .insertInto("financial_relief_request")
        .values({
          id,
          submitted_by_user_id: userId,
          member_id: data.memberId,
          status: "submitted",
          requested_membership_full: data.requestedMembershipFull,
          requested_membership_partial: data.requestedMembershipPartial,
          requested_match_fees: data.requestedMatchFees,
          partial_amount_pence: data.partialAmountPence ?? null,
          reason_category: data.reasonCategory ?? null,
          reason_text: data.reasonText ?? null,
          duration: data.duration ?? null,
          duration_other_text: data.durationOtherText ?? null,
          contribution_ability: data.contributionAbility ?? null,
          contribution_amount_pence: data.contributionAmountPence ?? null,
          volunteer_options: JSON.stringify(data.volunteerOptions),
          volunteer_notes: data.volunteerNotes ?? null,
          contact_preference: data.contactPreference,
          privacy_acknowledged_at: now,
          declaration_confirmed_at: now,
        })
        .execute();
    } catch (err: unknown) {
      // Partial unique index `financial_relief_request_one_open_uidx`
      // rejects a second open request for the same member.
      if (
        err instanceof Error &&
        err.message.includes("financial_relief_request_one_open_uidx")
      ) {
        httpError(409, "There is already an open request for this member");
      }
      throw err;
    }

    // Best-effort receipt email — never blocks submission.
    try {
      await deps.send({
        to: userEmail,
        subject: FinancialReliefReceived.subject,
        html: await render(
          createElement(FinancialReliefReceived.component, {
            imageBaseUrl: `${deps.baseUrl}/images`,
            recipientName: targetMember.name ?? "there",
          }),
        ),
      });
    } catch (err) {
      log.error(
        { err, requestId: id },
        "financial_relief_receipt_email_failed",
      );
    }

    return { id };
  };
}

export function getMyReliefStatus(db: Kysely<DB>) {
  return async (userEmail: string) => {
    const { allowed } = await resolveCallerMemberIds(db, userEmail).catch(
      () => ({
        allowed: new Set<string>(),
      }),
    );
    if (allowed.size === 0) return { requests: [] };

    const memberIds = [...allowed];

    // Surface the caller's submissions for themselves and any junior they
    // can speak for. We omit free-text reason so it's never re-displayed
    // even if a parent shares their screen — the member dashboard never
    // shows the application narrative.
    const requests = await db
      .selectFrom("financial_relief_request as r")
      .innerJoin("member as m", "m.id", "r.member_id")
      .where("r.member_id", "in", memberIds)
      .where((eb) =>
        eb.or([
          eb("r.status", "in", [
            "submitted",
            "in_review",
            "more_info_needed",
            "approved",
          ]),
          // Recently-decided declines/withdrawals: keep visible for 30 days.
          eb.and([
            eb("r.status", "in", ["declined", "withdrawn", "expired"]),
            eb(
              "r.updated_at",
              ">=",
              new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            ),
          ]),
        ]),
      )
      .select([
        "r.id",
        "r.member_id as memberId",
        "m.name as memberName",
        "r.status",
        "r.requested_membership_full as requestedMembershipFull",
        "r.requested_membership_partial as requestedMembershipPartial",
        "r.requested_match_fees as requestedMatchFees",
        "r.created_at as createdAt",
      ])
      .orderBy("r.created_at", "desc")
      .execute();

    // Pull active grants for these members so the UI can show a
    // "current support" summary alongside the request that produced it.
    const grants = await db
      .selectFrom("financial_relief_grant as g")
      .where("g.member_id", "in", memberIds)
      .where("g.closed_at", "is", null)
      .select([
        "g.request_id",
        "g.decision",
        "g.covers_membership",
        "g.covers_match_fees",
        "g.effective_from",
        "g.effective_to_exclusive",
        "g.member_facing_note",
      ])
      .execute();
    const grantByRequest = new Map(grants.map((g) => [g.request_id, g]));

    return {
      requests: requests.map((r) => {
        const grant = grantByRequest.get(r.id);
        return {
          id: r.id,
          memberId: r.memberId,
          memberName: r.memberName,
          status: r.status as RequestStatus,
          requestedMembershipFull: r.requestedMembershipFull,
          requestedMembershipPartial: r.requestedMembershipPartial,
          requestedMatchFees: r.requestedMatchFees,
          createdAt: toIsoString(r.createdAt),
          memberFacingNote: grant?.member_facing_note ?? null,
          activeGrant: grant
            ? {
                decision: grant.decision as
                  | "approved_full"
                  | "approved_partial"
                  | "approved_temporary",
                coversMembership: grant.covers_membership,
                coversMatchFees: grant.covers_match_fees,
                effectiveFrom: toIsoString(grant.effective_from),
                effectiveToExclusive: grant.effective_to_exclusive
                  ? toIsoString(grant.effective_to_exclusive)
                  : null,
              }
            : null,
        };
      }),
    };
  };
}

export function withdrawReliefRequest(db: Kysely<DB>) {
  return async (
    userId: string,
    userEmail: string,
    requestId: string,
    data: WithdrawRequest,
  ) => {
    const { allowed } = await resolveCallerMemberIds(db, userEmail);

    const request = await db
      .selectFrom("financial_relief_request")
      .where("id", "=", requestId)
      .select(["id", "member_id", "submitted_by_user_id", "status"])
      .executeTakeFirst();
    if (!request) httpError(404, "Request not found");

    // Ownership: the caller must either be the submitter, or be entitled
    // to act on behalf of the supported member (parent of a junior).
    const isOwner =
      request.submitted_by_user_id === userId || allowed.has(request.member_id);
    if (!isOwner) httpError(403, "You cannot withdraw this request");

    if (
      !["submitted", "in_review", "more_info_needed"].includes(request.status)
    ) {
      httpError(400, "This request cannot be withdrawn in its current state");
    }

    const now = new Date().toISOString();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("financial_relief_request")
        .set({
          status: "withdrawn",
          withdrawn_at: now,
          withdrawn_reason: data.reason ?? null,
          updated_at: now,
        })
        .where("id", "=", requestId)
        .execute();

      await trx
        .insertInto("financial_relief_event")
        .values({
          id: crypto.randomUUID(),
          request_id: requestId,
          event_type: "withdrawn",
          from_status: request.status,
          to_status: "withdrawn",
          note: data.reason ?? null,
          actor_user_id: userId,
        })
        .execute();
    });

    return { success: true };
  };
}

export function listReliefRequestsForAdmin(db: Kysely<DB>) {
  return async (params: ListReliefRequests) => {
    const offset = (params.page - 1) * params.pageSize;

    let baseQuery = db
      .selectFrom("financial_relief_request as r")
      .innerJoin("member as m", "m.id", "r.member_id")
      .innerJoin("user as u", "u.id", "r.submitted_by_user_id");

    if (params.status && params.status !== "all") {
      baseQuery = baseQuery.where("r.status", "=", params.status);
    }
    if (params.dateFrom) {
      baseQuery = baseQuery.where(
        "r.created_at",
        ">=",
        new Date(params.dateFrom),
      );
    }
    if (params.dateTo) {
      baseQuery = baseQuery.where(
        "r.created_at",
        "<=",
        new Date(params.dateTo),
      );
    }
    if (params.search) {
      const like = `%${params.search}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb("m.name", "ilike", like),
          eb("m.email", "ilike", like),
          eb("u.name", "ilike", like),
          eb("u.email", "ilike", like),
        ]),
      );
    }

    const [{ total }, rows, grants] = await Promise.all([
      baseQuery
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow(),
      baseQuery
        .leftJoin("financial_relief_grant as g", (join) =>
          join.onRef("g.request_id", "=", "r.id"),
        )
        .leftJoin("user as decider", "decider.id", "g.decided_by")
        .select([
          "r.id",
          "r.member_id as memberId",
          "m.name as memberName",
          "m.email as memberEmail",
          "r.submitted_by_user_id as submittedByUserId",
          "u.name as submittedByName",
          "u.email as submittedByEmail",
          "r.status",
          "r.requested_membership_full as requestedMembershipFull",
          "r.requested_membership_partial as requestedMembershipPartial",
          "r.requested_match_fees as requestedMatchFees",
          "r.created_at as createdAt",
          "r.updated_at as updatedAt",
          "g.decided_at as decidedAt",
          "decider.name as decidedByName",
        ])
        // Open requests first; within each group, newest first.
        .orderBy(
          (eb) =>
            eb
              .case()
              .when("r.status", "in", [
                "submitted",
                "in_review",
                "more_info_needed",
              ])
              .then(0)
              .else(1)
              .end(),
          "asc",
        )
        .orderBy("r.created_at", "desc")
        .limit(params.pageSize)
        .offset(offset)
        .execute(),
      // Empty array — grants are loaded inline via leftJoin above. Kept
      // as a placeholder so future event/grant lookups can join without
      // a second N+1.
      Promise.resolve([] as never[]),
    ]);
    void grants;

    return {
      items: rows.map((r) => ({
        id: r.id,
        memberId: r.memberId,
        memberName: r.memberName,
        memberEmail: r.memberEmail,
        submittedByUserId: r.submittedByUserId,
        submittedByName: r.submittedByName,
        submittedByEmail: r.submittedByEmail,
        status: r.status as RequestStatus,
        requestedMembershipFull: r.requestedMembershipFull,
        requestedMembershipPartial: r.requestedMembershipPartial,
        requestedMatchFees: r.requestedMatchFees,
        createdAt: toIsoString(r.createdAt),
        updatedAt: toIsoString(r.updatedAt),
        decidedAt: r.decidedAt ? toIsoString(r.decidedAt) : null,
        decidedByName: r.decidedByName,
      })),
      total: Number(total),
      page: params.page,
      pageSize: params.pageSize,
    };
  };
}

export function getReliefRequestDetail(db: Kysely<DB>) {
  return async (requestId: string) => {
    const request = await db
      .selectFrom("financial_relief_request as r")
      .innerJoin("member as m", "m.id", "r.member_id")
      .innerJoin("user as u", "u.id", "r.submitted_by_user_id")
      .where("r.id", "=", requestId)
      .select([
        "r.id",
        "r.member_id as memberId",
        "m.name as memberName",
        "m.email as memberEmail",
        "r.submitted_by_user_id as submittedByUserId",
        "u.name as submittedByName",
        "u.email as submittedByEmail",
        "r.status",
        "r.requested_membership_full as requestedMembershipFull",
        "r.requested_membership_partial as requestedMembershipPartial",
        "r.requested_match_fees as requestedMatchFees",
        "r.partial_amount_pence as partialAmountPence",
        "r.reason_category as reasonCategory",
        "r.reason_text as reasonText",
        "r.duration",
        "r.duration_other_text as durationOtherText",
        "r.contribution_ability as contributionAbility",
        "r.contribution_amount_pence as contributionAmountPence",
        "r.volunteer_options as volunteerOptions",
        "r.volunteer_notes as volunteerNotes",
        "r.contact_preference as contactPreference",
        "r.privacy_acknowledged_at as privacyAcknowledgedAt",
        "r.declaration_confirmed_at as declarationConfirmedAt",
        "r.withdrawn_at as withdrawnAt",
        "r.withdrawn_reason as withdrawnReason",
        "r.created_at as createdAt",
        "r.updated_at as updatedAt",
      ])
      .executeTakeFirst();
    if (!request) httpError(404, "Request not found");

    const events = await db
      .selectFrom("financial_relief_event as e")
      .leftJoin("user as u", "u.id", "e.actor_user_id")
      .where("e.request_id", "=", requestId)
      .select([
        "e.id",
        "e.event_type as eventType",
        "e.from_status as fromStatus",
        "e.to_status as toStatus",
        "e.note",
        "e.actor_user_id as actorUserId",
        "u.name as actorName",
        "e.created_at as createdAt",
      ])
      .orderBy("e.created_at", "asc")
      .execute();

    const grant = await db
      .selectFrom("financial_relief_grant as g")
      .leftJoin("user as decider", "decider.id", "g.decided_by")
      .where("g.request_id", "=", requestId)
      .where("g.closed_at", "is", null)
      .select([
        "g.id",
        "g.decision",
        "g.covers_membership as coversMembership",
        "g.covers_match_fees as coversMatchFees",
        "g.membership_partial_pence as membershipPartialPence",
        "g.effective_from as effectiveFrom",
        "g.effective_to_exclusive as effectiveToExclusive",
        "g.admin_notes as adminNotes",
        "g.member_facing_note as memberFacingNote",
        "g.decided_by as decidedBy",
        "decider.name as decidedByName",
        "g.decided_at as decidedAt",
        "g.closed_at as closedAt",
        "g.closed_by as closedBy",
        "g.closed_reason as closedReason",
      ])
      .executeTakeFirst();

    return {
      request: {
        ...request,
        status: request.status as RequestStatus,
        volunteerOptions: Array.isArray(request.volunteerOptions)
          ? (request.volunteerOptions as string[])
          : [],
        privacyAcknowledgedAt: toIsoString(request.privacyAcknowledgedAt),
        declarationConfirmedAt: toIsoString(request.declarationConfirmedAt),
        withdrawnAt: request.withdrawnAt
          ? toIsoString(request.withdrawnAt)
          : null,
        createdAt: toIsoString(request.createdAt),
        updatedAt: toIsoString(request.updatedAt),
      },
      events: events.map((e) => ({
        ...e,
        createdAt: toIsoString(e.createdAt),
      })),
      grant: grant
        ? {
            id: grant.id,
            decision: grant.decision as
              | "approved_full"
              | "approved_partial"
              | "approved_temporary",
            coversMembership: grant.coversMembership,
            coversMatchFees: grant.coversMatchFees,
            membershipPartialPence: grant.membershipPartialPence,
            effectiveFrom: toIsoString(grant.effectiveFrom),
            effectiveToExclusive: grant.effectiveToExclusive
              ? toIsoString(grant.effectiveToExclusive)
              : null,
            adminNotes: grant.adminNotes,
            memberFacingNote: grant.memberFacingNote,
            decidedBy: grant.decidedBy,
            decidedByName: grant.decidedByName,
            decidedAt: toIsoString(grant.decidedAt),
            closedAt: grant.closedAt ? toIsoString(grant.closedAt) : null,
            closedBy: grant.closedBy,
            closedReason: grant.closedReason,
          }
        : null,
    };
  };
}

export function transitionReliefRequestStatus(db: Kysely<DB>) {
  return async (
    adminUserId: string,
    requestId: string,
    data: TransitionStatus,
  ) => {
    const current = await db
      .selectFrom("financial_relief_request")
      .where("id", "=", requestId)
      .select(["id", "status"])
      .executeTakeFirst();
    if (!current) httpError(404, "Request not found");

    // Only meaningful from an "open" state — moving away from a decided/
    // declined/withdrawn/expired request loses the audit story.
    if (
      !["submitted", "in_review", "more_info_needed"].includes(current.status)
    ) {
      httpError(400, "Cannot transition a closed request");
    }
    if (current.status === data.toStatus) {
      return { success: true };
    }

    const now = new Date().toISOString();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("financial_relief_request")
        .set({ status: data.toStatus, updated_at: now })
        .where("id", "=", requestId)
        .execute();

      await trx
        .insertInto("financial_relief_event")
        .values({
          id: crypto.randomUUID(),
          request_id: requestId,
          event_type:
            data.toStatus === "more_info_needed"
              ? "more_info_requested"
              : "status_changed",
          from_status: current.status,
          to_status: data.toStatus,
          note: data.note ?? null,
          actor_user_id: adminUserId,
        })
        .execute();
    });

    return { success: true };
  };
}

export function declineReliefRequest(db: Kysely<DB>) {
  return async (
    adminUserId: string,
    requestId: string,
    data: DeclineRequest,
  ) => {
    const current = await db
      .selectFrom("financial_relief_request")
      .where("id", "=", requestId)
      .select(["id", "status"])
      .executeTakeFirst();
    if (!current) httpError(404, "Request not found");

    if (
      !["submitted", "in_review", "more_info_needed"].includes(current.status)
    ) {
      httpError(400, "Cannot decline a request that has already been closed");
    }

    const now = new Date().toISOString();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("financial_relief_request")
        .set({ status: "declined", updated_at: now })
        .where("id", "=", requestId)
        .execute();

      // Member-facing note is stored on a synthetic event row that the
      // member-facing API surfaces. (Grants are reserved for approvals;
      // we don't want a row that says "declined grant".)
      await trx
        .insertInto("financial_relief_event")
        .values({
          id: crypto.randomUUID(),
          request_id: requestId,
          event_type: "declined",
          from_status: current.status,
          to_status: "declined",
          note:
            data.memberFacingNote ??
            (data.adminNote ? `[admin] ${data.adminNote}` : null),
          actor_user_id: adminUserId,
        })
        .execute();
    });

    return { success: true };
  };
}

export function decideReliefRequest(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function closeReliefGrant(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function applyMembershipRelief(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function getReliefReport(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

function toIsoString(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
