import type { DB } from "@percy-main/db";
import { FinancialReliefReceived, type Email } from "@percy-main/email";
import type { RequestStatus } from "@percy-main/shared";
import { render } from "@react-email/render";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { createElement } from "react";
import type { SubmitReliefRequest, WithdrawRequest } from "./schemas.ts";

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

export function listReliefRequestsForAdmin(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function getReliefRequestDetail(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function transitionReliefRequestStatus(_db: Kysely<DB>) {
  return async () => await notImplemented();
}

export function declineReliefRequest(_db: Kysely<DB>) {
  return async () => await notImplemented();
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
