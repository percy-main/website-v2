import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import { getMatch } from "../matchday/service.ts";
import { applyReliefIfAny } from "./apply-relief.ts";
import type { SubmitReliefRequest } from "./schemas.ts";
import {
  applyMembershipRelief,
  closeReliefForArchivedMember,
  closeReliefGrant,
  decideReliefRequest,
  declineReliefRequest,
  getEligibleMembers,
  getMyReliefStatus,
  getReliefReport,
  getReliefRequestDetail,
  listReliefRequestsForAdmin,
  submitReliefRequest,
  transitionReliefRequestStatus,
  withdrawReliefRequest,
} from "./service.ts";

const log = createNoopLogger();

// We're not testing email rendering — keep the test focused on DB state.
vi.mock("react-email", () => ({
  render: vi.fn().mockResolvedValue("<html></html>"),
}));

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 60_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

function validSubmission(
  overrides: Partial<SubmitReliefRequest>,
): SubmitReliefRequest {
  return {
    memberId: "",
    requestedMembershipFull: false,
    requestedMembershipPartial: false,
    requestedMatchFees: true,
    partialAmountPence: null,
    reasonCategory: "cost_of_living",
    reasonText: "Things are tight at the moment.",
    duration: "season",
    durationOtherText: null,
    contributionAbility: "yes_reduced",
    contributionAmountPence: 1000,
    volunteerOptions: ["scoring", "matchday_setup"],
    volunteerNotes: "Happy to help most Saturday afternoons.",
    contactPreference: "email",
    privacyAcknowledged: true,
    declarationConfirmed: true,
    ...overrides,
  };
}

async function linkJunior(
  juniorMemberId: string,
  parentMemberId: string,
  createdBy: string,
) {
  await ctx.db
    .insertInto("member_parent_link")
    .values({
      member_id: juniorMemberId,
      parent_member_id: parentMemberId,
      created_by: createdBy,
    })
    .execute();
}

async function seedMember(overrides: Parameters<typeof seedTestUser>[1] = {}) {
  const result = await seedTestUser(ctx.db, overrides);
  if (!result.memberId) {
    throw new Error("Expected seedTestUser to create a member");
  }
  return { ...result, memberId: result.memberId };
}

describe("financial-relief (integration)", () => {
  it("getEligibleMembers returns self plus linked juniors", async () => {
    const parent = await seedMember();
    const junior = await seedMember();
    await linkJunior(junior.memberId, parent.memberId, parent.userId);

    const result = await getEligibleMembers(ctx.db)(parent.email);

    const ids = result.members.map((m) => m.memberId).sort();
    expect(ids).toEqual([parent.memberId, junior.memberId].sort());
    const self = result.members.find((m) => m.relationship === "self");
    const linked = result.members.find((m) => m.relationship === "junior");
    expect(self?.memberId).toBe(parent.memberId);
    expect(linked?.memberId).toBe(junior.memberId);
  });

  it("submit succeeds for own member id", async () => {
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );

    const row = await ctx.db
      .selectFrom("financial_relief_request")
      .where("id", "=", id)
      .selectAll()
      .executeTakeFirst();
    expect(row?.status).toBe("submitted");
    expect(row?.member_id).toBe(member.memberId);
    expect(row?.submitted_by_user_id).toBe(member.userId);
    expect(row?.requested_match_fees).toBe(true);
    expect(row?.reason_category).toBe("cost_of_living");
    expect(send).toHaveBeenCalledOnce();
  });

  it("submit succeeds for a linked junior member id", async () => {
    const parent = await seedMember();
    const junior = await seedMember();
    await linkJunior(junior.memberId, parent.memberId, parent.userId);

    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(
      parent.userId,
      parent.email,
      validSubmission({ memberId: junior.memberId }),
      log,
    );

    const row = await ctx.db
      .selectFrom("financial_relief_request")
      .where("id", "=", id)
      .select(["member_id"])
      .executeTakeFirst();
    expect(row?.member_id).toBe(junior.memberId);
  });

  it("submit rejects (403) a member id outside the caller's eligible set", async () => {
    const caller = await seedMember();
    const stranger = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    await expect(
      submit(
        caller.userId,
        caller.email,
        validSubmission({ memberId: stranger.memberId }),
        log,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("submit rejects (409) when an open request already exists", async () => {
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    await expect(
      submit(
        member.userId,
        member.email,
        validSubmission({ memberId: member.memberId }),
        log,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("submit succeeds again after the prior request is withdrawn", async () => {
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const withdraw = withdrawReliefRequest(ctx.db);

    const { id: firstId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    await withdraw(member.userId, member.email, firstId, {
      reason: "Changed mind",
    });

    await expect(
      submit(
        member.userId,
        member.email,
        validSubmission({ memberId: member.memberId }),
        log,
      ),
    ).resolves.toHaveProperty("id");
  });

  it("withdraw is rejected (403) for a non-owner non-parent", async () => {
    const owner = await seedMember();
    const stranger = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const withdraw = withdrawReliefRequest(ctx.db);

    const { id } = await submit(
      owner.userId,
      owner.email,
      validSubmission({ memberId: owner.memberId }),
      log,
    );

    await expect(
      withdraw(stranger.userId, stranger.email, id, { reason: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("withdraw transitions the request and records an event", async () => {
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const withdraw = withdrawReliefRequest(ctx.db);

    const { id } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    await withdraw(member.userId, member.email, id, { reason: "Got a bonus" });

    const row = await ctx.db
      .selectFrom("financial_relief_request")
      .where("id", "=", id)
      .select(["status", "withdrawn_at", "withdrawn_reason"])
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("withdrawn");
    expect(row.withdrawn_at).not.toBeNull();
    expect(row.withdrawn_reason).toBe("Got a bonus");

    const events = await ctx.db
      .selectFrom("financial_relief_event")
      .where("request_id", "=", id)
      .selectAll()
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("withdrawn");
    expect(events[0].to_status).toBe("withdrawn");
  });

  it("admin list returns open requests first, then closed by recency", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const a = await seedMember();
    const b = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id: aId } = await submit(
      a.userId,
      a.email,
      validSubmission({ memberId: a.memberId }),
      log,
    );
    const { id: bId } = await submit(
      b.userId,
      b.email,
      validSubmission({ memberId: b.memberId }),
      log,
    );
    await declineReliefRequest(ctx.db)(admin.userId, aId, {
      memberFacingNote: null,
      adminNote: "Insufficient grounds",
    });

    const result = await listReliefRequestsForAdmin(ctx.db)({
      page: 1,
      pageSize: 100,
      status: "all",
    });
    const ours = result.items.filter((i) =>
      ([aId, bId] as string[]).includes(i.id),
    );
    expect(ours.findIndex((i) => i.id === bId)).toBeLessThan(
      ours.findIndex((i) => i.id === aId),
    );
  });

  it("admin status transition records an event and updates the status", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    await transitionReliefRequestStatus(ctx.db)(admin.userId, id, {
      toStatus: "more_info_needed",
      note: "Could you confirm whether the junior plays Saturday matches?",
    });

    const detail = await getReliefRequestDetail(ctx.db)(id);
    expect(detail.request.status).toBe("more_info_needed");
    const moreInfo = detail.events.filter(
      (e) => e.eventType === "more_info_requested",
    );
    expect(moreInfo).toHaveLength(1);
    expect(moreInfo[0].toStatus).toBe("more_info_needed");
  });

  it("admin decline transitions, stores member-facing note, and blocks re-decline", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    await declineReliefRequest(ctx.db)(admin.userId, id, {
      memberFacingNote: "Sorry, we've used up this season's relief budget.",
      adminNote: "Reapply next season.",
    });

    const detail = await getReliefRequestDetail(ctx.db)(id);
    expect(detail.request.status).toBe("declined");
    expect(detail.grant).toBeNull();
    const declines = detail.events.filter((e) => e.eventType === "declined");
    expect(declines).toHaveLength(1);
    expect(declines[0].note).toBe(
      "Sorry, we've used up this season's relief budget.",
    );

    await expect(
      declineReliefRequest(ctx.db)(admin.userId, id, {
        memberFacingNote: null,
        adminNote: null,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("decide approves, creates a grant, forgives existing unpaid match-fee charges, and skips paid/in-flight ones", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    const { id: requestId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );

    // Seed three match-fee charges for this member:
    //   - "unpaidNoPI"  — pure unpaid, expect relieved
    //   - "unpaidLivePI" — has a non-cancelled PI, expect skipped
    //   - "paid"        — already paid, expect untouched
    const today = "2026-05-12";
    const ids = {
      unpaidNoPI: `charge-no-pi-${crypto.randomUUID()}`,
      unpaidLivePI: `charge-live-pi-${crypto.randomUUID()}`,
      paid: `charge-paid-${crypto.randomUUID()}`,
    };
    await ctx.db
      .insertInto("charge")
      .values([
        {
          id: ids.unpaidNoPI,
          member_id: member.memberId,
          description: "Match donation - Foo",
          amount_pence: 500,
          charge_date: today,
          created_by: admin.userId,
          type: "match_fee",
          source: "matchday",
        },
        {
          id: ids.unpaidLivePI,
          member_id: member.memberId,
          description: "Match donation - Bar",
          amount_pence: 500,
          charge_date: today,
          created_by: admin.userId,
          type: "match_fee",
          source: "matchday",
          stripe_payment_intent_id: "pi_live_test",
        },
        {
          id: ids.paid,
          member_id: member.memberId,
          description: "Match donation - Baz",
          amount_pence: 500,
          charge_date: today,
          created_by: admin.userId,
          type: "match_fee",
          source: "matchday",
          paid_at: new Date().toISOString(),
        },
      ])
      .execute();

    // Stub Stripe so the live-PI charge is reported as "processing" and
    // we skip relieving it.
    const stripeStub = {
      paymentIntents: {
        retrieve: vi.fn().mockResolvedValue({
          id: "pi_live_test",
          status: "processing",
        }),
      },
    } as unknown as import("stripe").default;

    const decide = decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    });

    const result = await decide(
      admin.userId,
      requestId,
      {
        decision: "approved_temporary",
        coversMembership: false,
        coversMatchFees: true,
        membershipPartialPence: null,
        effectiveFrom: today,
        effectiveToExclusive: null,
        adminNotes: null,
        memberFacingNote: "Match donations are waived this season.",
      },
      log,
    );

    expect(result.forgivenChargeCount).toBe(1);

    const charges = await ctx.db
      .selectFrom("charge")
      .where("id", "in", [ids.unpaidNoPI, ids.unpaidLivePI, ids.paid])
      .select(["id", "relieved_at", "paid_at"])
      .execute();
    const byId = new Map(charges.map((c) => [c.id, c]));
    expect(byId.get(ids.unpaidNoPI)?.relieved_at).not.toBeNull();
    expect(byId.get(ids.unpaidLivePI)?.relieved_at).toBeNull();
    expect(byId.get(ids.paid)?.relieved_at).toBeNull();
    expect(byId.get(ids.paid)?.paid_at).not.toBeNull();

    const detail = await getReliefRequestDetail(ctx.db)(requestId);
    expect(detail.request.status).toBe("approved");
    expect(detail.grant?.coversMatchFees).toBe(true);
  });

  it("a second concurrent decide for the same member is rejected by the unique index", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: r1 } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );

    const stripeStub = {
      paymentIntents: { retrieve: vi.fn() },
    } as unknown as import("stripe").default;
    const decide = decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    });
    const body = {
      decision: "approved_full" as const,
      coversMembership: false,
      coversMatchFees: true,
      membershipPartialPence: null,
      effectiveFrom: "2026-05-12",
      effectiveToExclusive: null,
      adminNotes: null,
      memberFacingNote: null,
    };
    await decide(admin.userId, r1, body, log);

    // Re-decide on the same closed request must reject.
    await expect(decide(admin.userId, r1, body, log)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("applyReliefIfAny auto-forgives a new match-fee charge when an active grant covers it", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: requestId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    const stripeStub = {
      paymentIntents: { retrieve: vi.fn() },
    } as unknown as import("stripe").default;
    await decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    })(
      admin.userId,
      requestId,
      {
        decision: "approved_temporary",
        coversMembership: false,
        coversMatchFees: true,
        membershipPartialPence: null,
        effectiveFrom: "2026-05-01",
        effectiveToExclusive: null,
        adminNotes: null,
        memberFacingNote: null,
      },
      log,
    );

    // Insert a new match-fee charge after the grant — applyReliefIfAny
    // should flip the relief audit columns inside the same trx.
    const chargeId = `c-${crypto.randomUUID()}`;
    await ctx.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: member.memberId,
          description: "Match donation - Future",
          amount_pence: 500,
          charge_date: "2026-06-01",
          created_by: admin.userId,
          type: "match_fee",
          source: "matchday",
        })
        .execute();
      await applyReliefIfAny(trx)({
        chargeId,
        memberId: member.memberId,
        type: "match_fee",
        chargeDate: "2026-06-01",
      });
    });

    const row = await ctx.db
      .selectFrom("charge")
      .where("id", "=", chargeId)
      .select(["relieved_at", "relieved_reason", "amount_pence"])
      .executeTakeFirstOrThrow();
    expect(row.relieved_at).not.toBeNull();
    expect(row.relieved_reason).toBe("financial relief");
    // Reporting value preserved.
    expect(row.amount_pence).toBe(500);
  });

  it("applyReliefIfAny does nothing for membership charges (admin-applied path)", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: requestId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    const stripeStub = {
      paymentIntents: { retrieve: vi.fn() },
    } as unknown as import("stripe").default;
    await decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    })(
      admin.userId,
      requestId,
      {
        decision: "approved_temporary",
        coversMembership: true,
        coversMatchFees: false,
        membershipPartialPence: null,
        effectiveFrom: "2026-05-01",
        effectiveToExclusive: null,
        adminNotes: null,
        memberFacingNote: null,
      },
      log,
    );

    const chargeId = `c-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("charge")
      .values({
        id: chargeId,
        member_id: member.memberId,
        description: "Membership renewal",
        amount_pence: 5000,
        charge_date: "2026-06-01",
        created_by: admin.userId,
        type: "membership",
        source: "stripe",
      })
      .execute();
    const result = await applyReliefIfAny(ctx.db)({
      chargeId,
      memberId: member.memberId,
      type: "membership",
      chargeDate: "2026-06-01",
    });
    expect(result.applied).toBe(false);
    const row = await ctx.db
      .selectFrom("charge")
      .where("id", "=", chargeId)
      .select(["relieved_at"])
      .executeTakeFirstOrThrow();
    expect(row.relieved_at).toBeNull();
  });

  it("closing a grant stops future charges being auto-forgiven; previously forgiven are untouched", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: requestId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    const stripeStub = {
      paymentIntents: { retrieve: vi.fn() },
    } as unknown as import("stripe").default;
    const decideResult = await decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    })(
      admin.userId,
      requestId,
      {
        decision: "approved_temporary",
        coversMembership: false,
        coversMatchFees: true,
        membershipPartialPence: null,
        effectiveFrom: "2026-05-01",
        effectiveToExclusive: null,
        adminNotes: null,
        memberFacingNote: null,
      },
      log,
    );

    // Forgive a charge under the active grant.
    const beforeId = `c-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("charge")
      .values({
        id: beforeId,
        member_id: member.memberId,
        description: "Match donation - Before close",
        amount_pence: 500,
        charge_date: "2026-06-01",
        created_by: admin.userId,
        type: "match_fee",
        source: "matchday",
      })
      .execute();
    await applyReliefIfAny(ctx.db)({
      chargeId: beforeId,
      memberId: member.memberId,
      type: "match_fee",
      chargeDate: "2026-06-01",
    });

    await closeReliefGrant(ctx.db)(admin.userId, decideResult.grantId, {
      reason: "Season ended",
    });

    // After-close charge: should NOT be auto-forgiven.
    const afterId = `c-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("charge")
      .values({
        id: afterId,
        member_id: member.memberId,
        description: "Match donation - After close",
        amount_pence: 500,
        charge_date: "2026-07-01",
        created_by: admin.userId,
        type: "match_fee",
        source: "matchday",
      })
      .execute();
    await applyReliefIfAny(ctx.db)({
      chargeId: afterId,
      memberId: member.memberId,
      type: "match_fee",
      chargeDate: "2026-07-01",
    });

    const rows = await ctx.db
      .selectFrom("charge")
      .where("id", "in", [beforeId, afterId])
      .select(["id", "relieved_at"])
      .execute();
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get(beforeId)?.relieved_at).not.toBeNull();
    expect(by.get(afterId)?.relieved_at).toBeNull();
  });

  it("archival closes active grants and force-declines open requests", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: openRequestId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );

    await closeReliefForArchivedMember(ctx.db)(admin.userId, member.memberId);

    const row = await ctx.db
      .selectFrom("financial_relief_request")
      .where("id", "=", openRequestId)
      .select(["status"])
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("declined");

    const events = await ctx.db
      .selectFrom("financial_relief_event")
      .where("request_id", "=", openRequestId)
      .where("event_type", "=", "declined")
      .selectAll()
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0].note).toBe("member archived");
  });

  it("applyMembershipRelief creates a relieved membership charge and extends paid_until", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: requestId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    const stripeStub = {
      paymentIntents: { retrieve: vi.fn() },
    } as unknown as import("stripe").default;
    const decide = await decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    })(
      admin.userId,
      requestId,
      {
        decision: "approved_temporary",
        coversMembership: true,
        coversMatchFees: false,
        membershipPartialPence: null,
        effectiveFrom: "2026-05-01",
        effectiveToExclusive: null,
        adminNotes: null,
        memberFacingNote: null,
      },
      log,
    );

    const { chargeId } = await applyMembershipRelief(ctx.db)(
      admin.userId,
      decide.grantId,
      {
        amountPence: 5000,
        effectiveDate: "2026-05-12",
        membershipPaidUntil: "2027-03-31",
        membershipType: "senior_player",
        description: "Senior membership (relief)",
      },
    );

    const charge = await ctx.db
      .selectFrom("charge")
      .where("id", "=", chargeId)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(charge.type).toBe("membership");
    expect(charge.amount_pence).toBe(5000);
    expect(charge.relieved_at).not.toBeNull();
    expect(charge.relief_grant_id).toBe(decide.grantId);

    const membership = await ctx.db
      .selectFrom("membership")
      .where("member_id", "=", member.memberId)
      .where("type", "=", "senior_player")
      .select(["paid_until"])
      .executeTakeFirstOrThrow();
    expect(membership.paid_until).toContain("2027-03-31");

    // Event audit row.
    const event = await ctx.db
      .selectFrom("financial_relief_event")
      .where("request_id", "=", requestId)
      .where("event_type", "=", "membership_relief_applied")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(event.note).toContain("senior_player");
  });

  it("decideReliefRequest with membershipApply atomically applies membership relief", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: requestId } = await submit(
      member.userId,
      member.email,
      validSubmission({
        memberId: member.memberId,
        requestedMembershipFull: true,
        requestedMatchFees: false,
      }),
      log,
    );
    const stripeStub = {
      paymentIntents: { retrieve: vi.fn() },
    } as unknown as import("stripe").default;

    const result = await decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    })(
      admin.userId,
      requestId,
      {
        decision: "approved_temporary",
        coversMembership: true,
        coversMatchFees: false,
        membershipPartialPence: null,
        effectiveFrom: "2026-05-21",
        effectiveToExclusive: "2026-12-31",
        adminNotes: null,
        memberFacingNote: null,
        membershipApply: {
          amountPence: 2500,
          membershipPaidUntil: "2026-12-31",
          membershipType: "concessionary",
          description: "Concessionary membership (relief)",
        },
      },
      log,
    );

    expect(result.grantId).toBeTruthy();

    // Relieved charge created with the right grant linkage.
    const charge = await ctx.db
      .selectFrom("charge")
      .where("relief_grant_id", "=", result.grantId)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(charge.type).toBe("membership");
    expect(charge.amount_pence).toBe(2500);
    expect(charge.relieved_at).not.toBeNull();
    expect(charge.charge_date).toContain("2026-05-21");

    // Membership row upserted with paid_until.
    const membership = await ctx.db
      .selectFrom("membership")
      .where("member_id", "=", member.memberId)
      .where("type", "=", "concessionary")
      .select(["paid_until"])
      .executeTakeFirstOrThrow();
    expect(membership.paid_until).toContain("2026-12-31");

    // Audit event emitted alongside grant_created in the same tx.
    const events = await ctx.db
      .selectFrom("financial_relief_event")
      .where("request_id", "=", requestId)
      .select(["event_type"])
      .orderBy("created_at", "asc")
      .execute();
    expect(events.map((e) => e.event_type)).toEqual([
      "grant_created",
      "membership_relief_applied",
    ]);
  });

  it("applyMembershipRelief rejects when the grant does not cover membership or is closed", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });
    const { id: requestId } = await submit(
      member.userId,
      member.email,
      validSubmission({ memberId: member.memberId }),
      log,
    );
    const stripeStub = {
      paymentIntents: { retrieve: vi.fn() },
    } as unknown as import("stripe").default;
    const decide = await decideReliefRequest(ctx.db, {
      stripe: stripeStub,
      baseUrl: "https://percymain.org",
      send,
    })(
      admin.userId,
      requestId,
      {
        decision: "approved_temporary",
        coversMembership: false,
        coversMatchFees: true,
        membershipPartialPence: null,
        effectiveFrom: "2026-05-01",
        effectiveToExclusive: null,
        adminNotes: null,
        memberFacingNote: null,
      },
      log,
    );

    await expect(
      applyMembershipRelief(ctx.db)(admin.userId, decide.grantId, {
        amountPence: 5000,
        effectiveDate: "2026-05-12",
        membershipPaidUntil: "2027-03-31",
        membershipType: "senior_player",
        description: "Senior membership (relief)",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("getReliefReport aggregates forgiven charges into type + section buckets", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const memberA = await seedMember();
    const memberB = await seedMember();

    // Seed teams: one junior, one senior.
    const juniorTeam = `team-${crypto.randomUUID()}`;
    const seniorTeam = `team-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("play_cricket_team")
      .values([
        {
          id: juniorTeam,
          name: "U13",
          site_id: "site",
          is_junior: true,
        },
        { id: seniorTeam, name: "1st XI", site_id: "site", is_junior: false },
      ])
      .execute();

    const juniorMd = `m-${crypto.randomUUID()}`;
    const seniorMd = `m-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("matchday")
      .values([
        {
          id: juniorMd,
          play_cricket_team_id: juniorTeam,
          match_date: "2026-05-01",
          opposition: "Junior Foo",
          status: "confirmed",
          created_by: admin.userId,
        },
        {
          id: seniorMd,
          play_cricket_team_id: seniorTeam,
          match_date: "2026-05-02",
          opposition: "Senior Bar",
          status: "confirmed",
          created_by: admin.userId,
        },
      ])
      .execute();

    // Seed three relieved charges. relieved_at is set to a far-future
    // date so the report query window can isolate them from charges
    // relieved by other tests in this file.
    const reliefDate = "2099-05-15T12:00:00.000Z";
    const charges = [
      {
        id: `c1-${crypto.randomUUID()}`,
        member_id: memberA.memberId,
        amount: 500,
        type: "match_fee",
        matchdayId: juniorMd,
        chargeDate: "2026-05-01",
        original: null as number | null,
      },
      {
        id: `c2-${crypto.randomUUID()}`,
        member_id: memberB.memberId,
        amount: 800,
        type: "match_fee",
        matchdayId: seniorMd,
        chargeDate: "2026-05-02",
        original: null,
      },
      {
        id: `c3-${crypto.randomUUID()}`,
        member_id: memberA.memberId,
        amount: 1000,
        type: "membership",
        matchdayId: null as string | null,
        chargeDate: "2026-05-03",
        // Partial: original was 5000, member paid 1000, waived 4000.
        // Reporting value should report the original.
        original: 5000,
      },
    ];
    for (const c of charges) {
      await ctx.db
        .insertInto("charge")
        .values({
          id: c.id,
          member_id: c.member_id,
          description: `desc ${c.id}`,
          amount_pence: c.amount,
          charge_date: c.chargeDate,
          created_by: admin.userId,
          type: c.type,
          source: "matchday",
          relieved_at: reliefDate,
          relieved_by: admin.userId,
          relieved_reason: "financial relief",
          ...(c.original ? { original_amount_pence: c.original } : {}),
        })
        .execute();
      if (c.matchdayId) {
        await ctx.db
          .insertInto("matchday_player")
          .values({
            id: `mp-${crypto.randomUUID()}`,
            matchday_id: c.matchdayId,
            member_id: c.member_id,
            player_name: "x",
            status: "playing",
            charge_id: c.id,
          })
          .execute();
      }
    }

    const report = await getReliefReport(ctx.db)({
      dateFrom: "2099-01-01T00:00:00Z",
      dateTo: "2099-12-31T23:59:59Z",
    });

    // Reporting value: 500 + 800 + 5000 = 6300
    expect(report.totalForgivenPence).toBe(6300);
    expect(report.byReliefType.matchFeePence).toBe(1300);
    expect(report.byReliefType.membershipPence).toBe(5000);
    expect(report.forgivenChargeCount).toBe(3);
    expect(report.membersSupported).toBe(2);

    // Sections: junior match fee in 'juniors', senior in 'senior',
    // senior-membership in 'senior'.
    expect(report.bySection.juniors.pence).toBe(500);
    expect(report.bySection.juniors.count).toBe(1);
    expect(report.bySection.juniors.members).toBe(1);
    expect(report.bySection.senior.pence).toBe(800 + 5000);
    expect(report.bySection.senior.count).toBe(2);
    expect(report.bySection.senior.members).toBe(2);
    expect(report.bySection.womensGirls.pence).toBe(0);
    expect(report.bySection.other.pence).toBe(0);
  });

  it("officials' matchday view reports a relieved match-fee as 'waived' and leaks no application detail", async () => {
    const admin = await seedTestUser(ctx.db, { role: "admin" });
    const member = await seedMember();

    // Seed a minimal matchday + a relieved match-fee charge for this member.
    const teamId = `team-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("play_cricket_team")
      .values({ id: teamId, name: "Test Team", site_id: "site" })
      .execute();

    const matchdayId = `m-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("matchday")
      .values({
        id: matchdayId,
        play_cricket_team_id: teamId,
        match_date: "2026-05-12",
        opposition: "Foo",
        status: "confirmed",
        created_by: admin.userId,
      })
      .execute();

    const chargeId = `c-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("charge")
      .values({
        id: chargeId,
        member_id: member.memberId,
        description: "Match donation - Foo",
        amount_pence: 500,
        charge_date: "2026-05-12",
        created_by: admin.userId,
        type: "match_fee",
        source: "matchday",
        relieved_at: new Date().toISOString(),
        relieved_by: admin.userId,
        relieved_reason: "financial relief",
      })
      .execute();

    const playerId = `p-${crypto.randomUUID()}`;
    await ctx.db
      .insertInto("matchday_player")
      .values({
        id: playerId,
        matchday_id: matchdayId,
        member_id: member.memberId,
        player_name: member.name,
        status: "playing",
        charge_id: chargeId,
      })
      .execute();

    // role='admin' bypasses the team_official check so the test
    // doesn't have to seed an official row.
    const detail = await getMatch(ctx.db)(admin.userId, "admin", matchdayId);
    expect(detail).toBeTruthy();
    if (!detail) throw new Error("getMatch returned null");
    const player = detail.players.find((p) => p.id === playerId);
    expect(player?.chargeStatus).toBe("waived");
    // Crucially: the officials' endpoint must NOT expose relief audit
    // columns, the application reason, or the grant note.
    expect(Object.keys(player ?? {})).not.toContain("chargeRelievedAt");
    expect(Object.keys(player ?? {})).not.toContain("relieved_at");
    expect(Object.keys(player ?? {})).not.toContain("reason_text");
  });

  it("getMyReliefStatus returns the caller's own and linked-junior requests", async () => {
    const parent = await seedMember();
    const junior = await seedMember();
    await linkJunior(junior.memberId, parent.memberId, parent.userId);
    const send = vi.fn().mockResolvedValue(undefined);
    const submit = submitReliefRequest(ctx.db, {
      baseUrl: "https://percymain.org",
      send,
    });

    await submit(
      parent.userId,
      parent.email,
      validSubmission({ memberId: parent.memberId }),
      log,
    );
    await submit(
      parent.userId,
      parent.email,
      validSubmission({ memberId: junior.memberId }),
      log,
    );

    const { requests } = await getMyReliefStatus(ctx.db)(parent.email);
    const ids = requests.map((r) => r.memberId).sort();
    expect(ids).toEqual([parent.memberId, junior.memberId].sort());
  });
});
