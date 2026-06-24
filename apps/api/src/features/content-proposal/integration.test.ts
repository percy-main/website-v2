import type { Email } from "@percy-main/email";
import type { PersonPhoto } from "@percy-main/shared/content";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  createContent,
  getContent,
  getPublishedContent,
  listRevisions,
  publishContent,
  unpublishContent,
} from "../content/service.ts";
import {
  approveProfileProposal,
  getProfileEditState,
  getProposalDetail,
  listPendingProposals,
  rejectProfileProposal,
  submitProfileProposal,
} from "./service.ts";

const body = (text: string) => [
  {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  },
];

const photo = (n: string): PersonPhoto => ({
  sources: { "image/webp": `/uploads/${n}.webp 1x` },
  img: { src: `/uploads/${n}.png`, w: 200, h: 200 },
});

// Silent FastifyBaseLogger for the notify deps (no casts, no real I/O).
const log = Fastify({ logger: false }).log;

function recordingDeps() {
  const sent: Array<{ to: string; subject: string }> = [];
  const deps = {
    baseUrl: "http://localhost:5173",
    send: (email: Email) => {
      sent.push({ to: email.to, subject: email.subject });
      return Promise.resolve();
    },
    log,
  };
  return { deps, sent };
}

describe("content-proposal service (integration)", () => {
  let ctx: TestContext;
  let authorId: string;
  let reviewerId: string;
  let reviewerEmail: string;
  let nonReviewerEmail: string;

  // Create a person profile and link a fresh owner's member row to it by
  // slug - the exact eligibility chain (user.email -> member -> slug ->
  // person content_item) the feature relies on.
  async function seedOwnerWithProfile(
    slug: string,
    name: string,
    opts: { photo?: PersonPhoto } = {},
  ) {
    const owner = await seedTestUser(ctx.db, {
      name,
      withMember: true,
    });
    const { id } = await createContent(ctx.db)({
      kind: "person",
      slug,
      title: name,
      description: null,
      body: body("Original bio"),
      metadata: {
        isDBSChecked: true,
        hasLeftClub: false,
        ...(opts.photo ? { photo: opts.photo } : {}),
      },
      userId: authorId,
    });
    if (!owner.memberId)
      throw new Error("seedTestUser did not create a member");
    await ctx.db
      .updateTable("member")
      .set({ slug })
      .where("id", "=", owner.memberId)
      .execute();
    return { ...owner, contentId: id };
  }

  // A member slug-linked (the backfill default) but with NO person page yet -
  // the "create on first edit" precondition.
  async function seedLinkedMemberNoProfile(slug: string, name: string) {
    const member = await seedTestUser(ctx.db, { name, withMember: true });
    if (!member.memberId)
      throw new Error("seedTestUser did not create a member");
    await ctx.db
      .updateTable("member")
      .set({ slug })
      .where("id", "=", member.memberId)
      .execute();
    return member;
  }

  beforeAll(async () => {
    ctx = await startTestContainer();
    ({ userId: authorId } = await seedTestUser(ctx.db, { withMember: false }));
    // people_editor holds content_people:publish - a reviewer.
    const reviewer = await seedTestUser(ctx.db, {
      role: "people_editor",
      withMember: false,
      name: "Rev Iewer",
    });
    reviewerId = reviewer.userId;
    reviewerEmail = reviewer.email;
    // news_editor does NOT hold content_people:publish - never notified.
    const nonReviewer = await seedTestUser(ctx.db, {
      role: "news_editor",
      withMember: false,
      name: "News Person",
    });
    nonReviewerEmail = nonReviewer.email;
  }, 120_000);

  afterAll(async () => {
    await stopTestContainer(ctx);
  });

  it("reports no editable profile for a member without a slug link", async () => {
    const stranger = await seedTestUser(ctx.db, { withMember: true });
    const state = await getProfileEditState(ctx.db)(stranger.email);
    expect(state.profile).toBeNull();
    expect(state.pendingProposal).toBeNull();
  });

  it("surfaces the slug-linked profile to its owner", async () => {
    const owner = await seedOwnerWithProfile("alice-owner", "Alice Owner");
    const state = await getProfileEditState(ctx.db)(owner.email);
    expect(state.profile?.contentId).toBe(owner.contentId);
    expect(state.profile?.slug).toBe("alice-owner");
    expect(state.profile?.title).toBe("Alice Owner");
    expect(state.pendingProposal).toBeNull();
  });

  it("submits a proposal and notifies publishers but not the proposer or non-publishers", async () => {
    const owner = await seedOwnerWithProfile("bob-owner", "Bob Owner");
    const { deps, sent } = recordingDeps();

    const result = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Bob's updated bio"),
      photo: photo("bob"),
    });
    expect(result.status).toBe("pending");

    const recipients = sent.map((s) => s.to);
    expect(recipients).toContain(reviewerEmail);
    expect(recipients).not.toContain(nonReviewerEmail);
    expect(recipients).not.toContain(owner.email);

    // The owner now sees their pending proposal and cannot edit live yet.
    const state = await getProfileEditState(ctx.db)(owner.email);
    expect(state.pendingProposal?.id).toBe(result.id);
    expect(state.pendingProposal?.photo?.img.src).toBe("/uploads/bob.png");
  });

  it("rejects a non-eligible caller's submission with 403", async () => {
    const stranger = await seedTestUser(ctx.db, { withMember: true });
    const { deps } = recordingDeps();
    await expect(
      submitProfileProposal(
        ctx.db,
        deps,
      )({
        userId: stranger.userId,
        userEmail: stranger.email,
        body: body("nope"),
        photo: null,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("blocks a second proposal while one is pending (409)", async () => {
    const owner = await seedOwnerWithProfile("carol-owner", "Carol Owner");
    const { deps } = recordingDeps();
    const submit = submitProfileProposal(ctx.db, deps);
    await submit({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("first"),
      photo: null,
    });
    await expect(
      submit({
        userId: owner.userId,
        userEmail: owner.email,
        body: body("second"),
        photo: null,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("offers a virtual profile to a linked member with no page yet", async () => {
    const member = await seedLinkedMemberNoProfile("ned-new", "Ned New");
    const state = await getProfileEditState(ctx.db)(member.email);
    expect(state.profile).not.toBeNull();
    expect(state.profile?.contentId).toBeNull();
    expect(state.profile?.slug).toBe("ned-new");
    expect(state.profile?.title).toBe("Ned New");
    expect(state.profile?.body).toEqual([]);
    expect(state.pendingProposal).toBeNull();
  });

  it("creates a draft profile on first submit and publishes it on approval", async () => {
    const member = await seedLinkedMemberNoProfile(
      "opal-author",
      "Opal Author",
    );

    // Public lookup before any submit: the member-backed stub stands in (no
    // page exists yet), so a leaderboard click does not dead-end.
    const stub = await getPublishedContent(ctx.db)({
      kind: "person",
      slug: "opal-author",
    });
    expect(stub.id).toBe("member-stub:opal-author");

    const { deps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: member.userId,
      userEmail: member.email,
      body: body("Opal's first bio"),
      photo: null,
    });

    // The draft page now exists and is the owner's editable profile, but it
    // is NOT public yet - the stub still answers the public lookup.
    const afterSubmit = await getProfileEditState(ctx.db)(member.email);
    expect(afterSubmit.profile?.contentId).not.toBeNull();
    expect(afterSubmit.pendingProposal?.id).toBe(proposalId);
    const stillStub = await getPublishedContent(ctx.db)({
      kind: "person",
      slug: "opal-author",
    });
    expect(stillStub.id).toBe("member-stub:opal-author");

    // Approval publishes the page: the real profile now answers publicly.
    await approveProfileProposal(
      ctx.db,
      deps,
    )({ proposalId, reviewerUserId: reviewerId });

    const published = await getPublishedContent(ctx.db)({
      kind: "person",
      slug: "opal-author",
    });
    expect(published.id).not.toBe("member-stub:opal-author");
    expect(published.title).toBe("Opal Author");
    expect(published.body[0]?.content).toMatchObject([
      { text: "Opal's first bio" },
    ]);
    // A self-created profile starts with the safe default flags.
    expect(published.metadata).toMatchObject({
      isDBSChecked: false,
      hasLeftClub: false,
    });

    // Owner can edit again; the proposal history is empty-draft + approval.
    const settled = await getProfileEditState(ctx.db)(member.email);
    expect(settled.pendingProposal).toBeNull();
    const contentId = settled.profile?.contentId;
    if (!contentId) throw new Error("profile should now have a content id");
    const { revisions } = await listRevisions(ctx.db)(contentId);
    expect(revisions).toHaveLength(2);
  });

  it("does not republish a taken-down profile when an edit is approved", async () => {
    const owner = await seedOwnerWithProfile("quinn-removed", "Quinn Removed");
    // Take it live, then deliberately unpublish it. Unpublish flips status
    // back to draft but RETAINS published_at as the ever-published marker.
    await publishContent(ctx.db)({
      contentId: owner.contentId,
      userId: authorId,
    });
    await unpublishContent(ctx.db)({
      contentId: owner.contentId,
      userId: authorId,
    });

    const { deps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Trying to sneak back online"),
      photo: null,
    });
    await approveProfileProposal(
      ctx.db,
      deps,
    )({ proposalId, reviewerUserId: reviewerId });

    // The edit applied, but the profile stays unpublished - a takedown sticks.
    const after = await getContent(ctx.db)(owner.contentId);
    expect(after.status).toBe("draft");
    expect(after.body[0]?.content).toMatchObject([
      { text: "Trying to sneak back online" },
    ]);
    // Still not served publicly: a tombstone (410), never resurrected.
    await expect(
      getPublishedContent(ctx.db)({ kind: "person", slug: "quinn-removed" }),
    ).rejects.toMatchObject({ statusCode: 410 });
  });

  it("approves a proposal: applies bio + photo, preserves flags + title, writes a revision, emails the proposer", async () => {
    const owner = await seedOwnerWithProfile("dave-owner", "Dave Owner");
    const { deps: submitDeps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      submitDeps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Dave's approved bio"),
      photo: photo("dave"),
    });

    const { deps: approveDeps, sent } = recordingDeps();
    const result = await approveProfileProposal(
      ctx.db,
      approveDeps,
    )({
      proposalId,
      reviewerUserId: reviewerId,
    });
    expect(result.status).toBe("approved");

    // The live profile now carries the new bio + photo, but title and the
    // safeguarding flags are untouched (admin-only).
    const profile = await getContent(ctx.db)(owner.contentId);
    expect(profile.title).toBe("Dave Owner");
    expect(profile.body[0]?.content).toMatchObject([
      { text: "Dave's approved bio" },
    ]);
    expect(profile.metadata.isDBSChecked).toBe(true);
    expect(profile.metadata.hasLeftClub).toBe(false);
    expect(profile.metadata.photo).toMatchObject({
      img: { src: "/uploads/dave.png" },
    });

    // A revision was written, attributed to the reviewer (the approver).
    const { revisions } = await listRevisions(ctx.db)(owner.contentId);
    expect(revisions).toHaveLength(2); // creation + approval
    expect(revisions[0]?.savedBy).toBe(reviewerId);

    // The proposer was emailed; the owner can submit again.
    expect(sent.map((s) => s.to)).toContain(owner.email);
    const state = await getProfileEditState(ctx.db)(owner.email);
    expect(state.pendingProposal).toBeNull();
  });

  it("approving a photo-removal proposal removes the live photo, keeping flags", async () => {
    const owner = await seedOwnerWithProfile("jo-photo", "Jo Photo", {
      photo: photo("jo-orig"),
    });
    // Sanity: the profile starts with a photo.
    const before = await getContent(ctx.db)(owner.contentId);
    expect(before.metadata.photo).toMatchObject({
      img: { src: "/uploads/jo-orig.png" },
    });

    const { deps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Bio with the photo removed"),
      photo: null,
    });
    await approveProfileProposal(
      ctx.db,
      deps,
    )({
      proposalId,
      reviewerUserId: reviewerId,
    });

    const after = await getContent(ctx.db)(owner.contentId);
    expect(after.metadata.photo).toBeUndefined();
    expect(after.metadata.isDBSChecked).toBe(true);
  });

  it("approving a bio-only edit keeps the existing photo (resent unchanged)", async () => {
    const owner = await seedOwnerWithProfile("kim-photo", "Kim Photo", {
      photo: photo("kim-orig"),
    });
    const { deps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Updated bio"),
      // The UI seeds the photo field from the current photo, so an unchanged
      // photo round-trips as the same value.
      photo: photo("kim-orig"),
    });
    await approveProfileProposal(
      ctx.db,
      deps,
    )({
      proposalId,
      reviewerUserId: reviewerId,
    });

    const after = await getContent(ctx.db)(owner.contentId);
    expect(after.metadata.photo).toMatchObject({
      img: { src: "/uploads/kim-orig.png" },
    });
    expect(after.body[0]?.content).toMatchObject([{ text: "Updated bio" }]);
  });

  it("approving an already-reviewed proposal returns 409", async () => {
    const owner = await seedOwnerWithProfile("erin-owner", "Erin Owner");
    const { deps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Erin bio"),
      photo: null,
    });
    await approveProfileProposal(
      ctx.db,
      deps,
    )({
      proposalId,
      reviewerUserId: reviewerId,
    });
    await expect(
      approveProfileProposal(
        ctx.db,
        deps,
      )({
        proposalId,
        reviewerUserId: reviewerId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects a proposal: leaves the profile untouched, stores the note, emails the proposer", async () => {
    const owner = await seedOwnerWithProfile("frank-owner", "Frank Owner");
    const { deps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Frank's rejected bio"),
      photo: photo("frank"),
    });

    const { deps: rejectDeps, sent } = recordingDeps();
    const result = await rejectProfileProposal(
      ctx.db,
      rejectDeps,
    )({
      proposalId,
      reviewerUserId: reviewerId,
      note: "Please keep it under 100 words",
    });
    expect(result.status).toBe("rejected");

    // Live profile is unchanged (still the original bio, no photo).
    const profile = await getContent(ctx.db)(owner.contentId);
    expect(profile.body[0]?.content).toMatchObject([{ text: "Original bio" }]);
    expect(profile.metadata.photo).toBeUndefined();

    // Note persisted, proposer emailed, owner free to submit again.
    const row = await ctx.db
      .selectFrom("content_proposal")
      .select(["status", "decision_note"])
      .where("id", "=", proposalId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("rejected");
    expect(row.decision_note).toBe("Please keep it under 100 words");
    expect(sent.map((s) => s.to)).toContain(owner.email);

    const state = await getProfileEditState(ctx.db)(owner.email);
    expect(state.pendingProposal).toBeNull();
  });

  it("returns proposed-vs-current detail for the reviewer, and lists pending oldest-first", async () => {
    const owner = await seedOwnerWithProfile("grace-owner", "Grace Owner");
    const { deps } = recordingDeps();
    const { id: proposalId } = await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Grace proposed bio"),
      photo: photo("grace"),
    });

    const detail = await getProposalDetail(ctx.db)(proposalId);
    expect(detail.status).toBe("pending");
    expect(detail.title).toBe("Grace Owner");
    expect(detail.proposed.body[0]?.content).toMatchObject([
      { text: "Grace proposed bio" },
    ]);
    expect(detail.proposed.photo?.img.src).toBe("/uploads/grace.png");
    expect(detail.current.body[0]?.content).toMatchObject([
      { text: "Original bio" },
    ]);
    expect(detail.current.photo).toBeNull();

    const { items } = await listPendingProposals(ctx.db)();
    const ids = items.map((i) => i.id);
    expect(ids).toContain(proposalId);
  });

  it("does not notify a reviewer about their own proposal", async () => {
    // A people_editor who also owns a profile submits an edit; they must not
    // be asked to review themselves.
    const reviewerOwner = await seedTestUser(ctx.db, {
      role: "people_editor",
      withMember: true,
      name: "Helen Editor",
    });
    await createContent(ctx.db)({
      kind: "person",
      slug: "helen-editor",
      title: "Helen Editor",
      description: null,
      body: body("Original bio"),
      metadata: { isDBSChecked: false, hasLeftClub: false },
      userId: authorId,
    });
    if (!reviewerOwner.memberId) throw new Error("expected a member");
    await ctx.db
      .updateTable("member")
      .set({ slug: "helen-editor" })
      .where("id", "=", reviewerOwner.memberId)
      .execute();

    const { deps, sent } = recordingDeps();
    await submitProfileProposal(
      ctx.db,
      deps,
    )({
      userId: reviewerOwner.userId,
      userEmail: reviewerOwner.email,
      body: body("Helen's new bio"),
      photo: null,
    });
    expect(sent.map((s) => s.to)).not.toContain(reviewerOwner.email);
  });

  it("submit still succeeds when reviewer notification fails (best-effort)", async () => {
    const owner = await seedOwnerWithProfile("ian-owner", "Ian Owner");
    const failingDeps = {
      baseUrl: "http://localhost:5173",
      send: () => Promise.reject(new Error("SES is down")),
      log,
    };
    const result = await submitProfileProposal(
      ctx.db,
      failingDeps,
    )({
      userId: owner.userId,
      userEmail: owner.email,
      body: body("Ian bio"),
      photo: null,
    });
    expect(result.status).toBe("pending");
    const state = await getProfileEditState(ctx.db)(owner.email);
    expect(state.pendingProposal?.id).toBe(result.id);
  });
});
