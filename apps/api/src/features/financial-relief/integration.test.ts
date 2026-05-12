import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNoopLogger } from "../../lib/worker-logger.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import type { SubmitReliefRequest } from "./schemas.ts";
import {
  getEligibleMembers,
  getMyReliefStatus,
  submitReliefRequest,
  withdrawReliefRequest,
} from "./service.ts";

const log = createNoopLogger();

// We're not testing email rendering — keep the test focused on DB state.
vi.mock("@react-email/render", () => ({
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
