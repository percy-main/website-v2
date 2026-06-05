import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SendPush } from "../../lib/push-sender.ts";
import { noopS3Uploader } from "../../lib/s3-upload.ts";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  addPlayer,
  approveExpense,
  cancelMatchday,
  createMatchday,
  deleteExpense,
  finishMatch,
  getMatch,
  getMyUpcomingMatches,
  getPastUnfinishedMatchdays,
  listMatches,
  listPendingExpenses,
  listTeams,
  markExpenseReimbursed,
  markFeePaid,
  notifyMatchCharges,
  recordExpense,
  rejectExpense,
  removePlayer,
  searchMembers,
  submitExpenseClaim,
  withdrawFromMatch,
} from "./service.ts";

const noopSendEmail = () => Promise.resolve();
const noopSendPush: SendPush = (sub) =>
  Promise.resolve({ ok: true, endpoint: sub.endpoint });
const testConfig = { BASE_URL: "https://example.test" };

async function finishAsTest(
  matchdayId: string,
  userId: string,
  data: {
    playerStatuses?: Array<{
      matchdayPlayerId: string;
      status: "playing" | "dropped_out" | "no_show";
    }>;
    feeOverrides?: Array<{ matchdayPlayerId: string; amountPence: number }>;
    resultType?: "W" | "L" | "D" | "T" | "A" | "C" | "N";
  } = {},
) {
  return finishMatch(ctx.db)(userId, "admin", matchdayId, {
    resultType: data.resultType ?? "W",
    playerStatuses: data.playerStatuses ?? [],
    feeOverrides: data.feeOverrides ?? [],
  });
}

// Fire the donation-request batch the way the route does, after the
// match has been wrapped up.
async function notifyAsTest(
  matchdayId: string,
  userId: string,
  deps: {
    sendEmail?: (e: {
      to: string;
      subject: string;
      html: string;
    }) => Promise<void>;
    sendPush?: SendPush;
  } = {},
) {
  const { createNoopLogger } = await import("../../lib/worker-logger.ts");
  return notifyMatchCharges(
    ctx.db,
    deps.sendEmail ?? noopSendEmail,
    deps.sendPush ?? noopSendPush,
    testConfig,
  )(userId, "admin", matchdayId, createNoopLogger());
}

// Drive a player-initiated dropout the way the route does.
async function withdrawAsTest(
  email: string,
  matchdayPlayerId: string,
  deps: {
    sendEmail?: (e: {
      to: string;
      subject: string;
      html: string;
    }) => Promise<void>;
    sendPush?: SendPush;
  } = {},
) {
  const { createNoopLogger } = await import("../../lib/worker-logger.ts");
  return withdrawFromMatch(
    ctx.db,
    deps.sendEmail ?? noopSendEmail,
    deps.sendPush ?? noopSendPush,
    testConfig,
  )(email, matchdayPlayerId, createNoopLogger());
}

const s3 = noopS3Uploader;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

/** Seed a play_cricket_team row. */
async function seedTeam(id?: string) {
  const teamId = id ?? `pct-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("play_cricket_team")
    .values({
      id: teamId,
      name: `Team ${teamId.slice(0, 6)}`,
      site_id: "site-1",
    })
    .execute();
  return teamId;
}

/** Seed a matchday row. */
async function seedMatchday(overrides: {
  teamId: string;
  createdBy: string;
  status?: string;
  matchDate?: string;
}) {
  const id = `md-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("matchday")
    .values({
      id,
      play_cricket_team_id: overrides.teamId,
      match_date: overrides.matchDate ?? "2026-06-15",
      opposition: "Opposition CC",
      created_by: overrides.createdBy,
      status: overrides.status ?? "pending",
    })
    .execute();
  return id;
}

/** Seed a team_official row linking a user to a team. */
async function seedTeamOfficial(userId: string, teamId: string) {
  await ctx.db
    .insertInto("team_official")
    .values({ user_id: userId, play_cricket_team_id: teamId })
    .execute();
}

/** Seed a member row. */
async function seedMember(name: string, email: string, category?: string) {
  const id = `mem-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("member")
    .values({
      id,
      name,
      email,
      title: "",
      address: "",
      postcode: "",
      dob: "",
      telephone: "",
      emergency_contact_name: "",
      emergency_contact_telephone: "",
      member_category: category ?? "senior",
    })
    .execute();
  return id;
}

/** Seed a match fee rate. */
async function seedFeeRate(overrides: {
  teamId?: string;
  competitionType?: string;
  memberCategory: string;
  amountPence: number;
}) {
  const id = `mfr-${crypto.randomUUID()}`;
  await ctx.db
    .insertInto("match_fee_rate")
    .values({
      id,
      play_cricket_team_id: overrides.teamId ?? null,
      competition_type: overrides.competitionType ?? null,
      member_category: overrides.memberCategory,
      amount_pence: overrides.amountPence,
    })
    .execute();
  return id;
}

describe("matchday service (integration)", () => {
  describe("listMatches", () => {
    it("returns empty when no matchdays exist for the user", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `nomatches-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });

      const result = await listMatches(ctx.db)(userId, "admin", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      expect(result.items).toEqual([]);
    });

    it("returns matches after seeding for admin user", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `adminmatches-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchId = await seedMatchday({ teamId, createdBy: userId });

      const result = await listMatches(ctx.db)(userId, "admin", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      const ids = result.items.map((m) => m.id);
      expect(ids).toContain(matchId);
    });

    it("non-admin only sees matches for teams they officiate", async () => {
      const { userId: officialId } = await seedTestUser(ctx.db, {
        email: `official-${crypto.randomUUID()}@test.com`,
      });
      const { userId: otherUserId } = await seedTestUser(ctx.db, {
        email: `other-${crypto.randomUUID()}@test.com`,
      });

      const teamA = await seedTeam();
      const teamB = await seedTeam();

      await seedTeamOfficial(officialId, teamA);

      const matchA = await seedMatchday({
        teamId: teamA,
        createdBy: officialId,
      });
      await seedMatchday({ teamId: teamB, createdBy: otherUserId });

      const result = await listMatches(ctx.db)(officialId, "official", {
        limit: 20,
        offset: 0,
        statusFilter: "all",
      });

      const ids = result.items.map((m) => m.id);
      expect(ids).toContain(matchA);
      // Should not contain teamB's match
      expect(result.items.every((m) => m.play_cricket_team_id === teamA)).toBe(
        true,
      );
    });

    it("filters by status", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `statusfilter-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const pendingId = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "pending",
      });
      await seedMatchday({
        teamId,
        createdBy: userId,
        status: "confirmed",
      });

      const result = await listMatches(ctx.db)(userId, "admin", {
        limit: 20,
        offset: 0,
        statusFilter: "pending",
      });

      const ids = result.items.map((m) => m.id);
      expect(ids).toContain(pendingId);
      for (const item of result.items) {
        expect(item.status).toBe("pending");
      }
    });
  });

  describe("listTeams", () => {
    it("returns teams for an official", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `listteams-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const teamId = await seedTeam();
      await seedTeamOfficial(userId, teamId);

      const result = await listTeams(ctx.db)(userId, "official");
      const ids = result.map((t) => t.id);
      expect(ids).toContain(teamId);
    });
  });

  describe("createMatchday", () => {
    it("creates a matchday for an accessible team", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `create-md-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();

      const result = await createMatchday(ctx.db)(userId, "admin", {
        teamId,
        matchDate: "2026-07-01",
        opposition: "Rival CC",
      });

      expect(result.id).toBeDefined();

      // Verify in DB
      const row = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", result.id)
        .selectAll()
        .executeTakeFirst();
      expect(row?.opposition).toBe("Rival CC");
      expect(row?.status).toBe("pending");
    });

    it("rejects duplicate matchday for same team and date", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `dup-md-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();

      await createMatchday(ctx.db)(userId, "admin", {
        teamId,
        matchDate: "2026-07-02",
        opposition: "First CC",
      });

      await expect(
        createMatchday(ctx.db)(userId, "admin", {
          teamId,
          matchDate: "2026-07-02",
          opposition: "Second CC",
        }),
      ).rejects.toThrow("already exists");
    });

    it("rejects when an open availability request covers the match", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `openavail-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const playCricketMatchId = `pcm-${crypto.randomUUID()}`;

      // Seed an open availability request + fixture for this PC match.
      const requestId = `req-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("availability_request")
        .values({
          id: requestId,
          created_by: userId,
          date_from: "2026-07-03",
          date_to: "2026-07-10",
          status: "open",
        })
        .execute();
      await ctx.db
        .insertInto("availability_fixture")
        .values({
          id: `fix-${crypto.randomUUID()}`,
          availability_request_id: requestId,
          match_date: "2026-07-03",
          play_cricket_match_id: playCricketMatchId,
          play_cricket_team_id: teamId,
          opposition: "Lintz CC",
          is_home: true,
        })
        .execute();

      await expect(
        createMatchday(ctx.db)(userId, "admin", {
          teamId,
          matchDate: "2026-07-03",
          opposition: "Lintz CC",
          playCricketMatchId,
        }),
      ).rejects.toThrow("availability request is still open");

      // Closing the request lets the matchday come into being via the
      // close flow, NOT via createMatchday directly. Verify createMatchday
      // also stops refusing once the request is closed.
      await ctx.db
        .updateTable("availability_request")
        .set({ status: "closed" })
        .where("id", "=", requestId)
        .execute();

      const result = await createMatchday(ctx.db)(userId, "admin", {
        teamId,
        matchDate: "2026-07-03",
        opposition: "Lintz CC",
        playCricketMatchId,
      });
      expect(result.id).toBeDefined();
    });

    it("rejects open-request even when caller omits playCricketMatchId", async () => {
      // The "Pick team" FE flow always supplies playCricketMatchId, but
      // the guard must still catch callers that don't (admin tools, future
      // friendlies UI) by falling back to (team, date) matching.
      const { userId } = await seedTestUser(ctx.db, {
        email: `nopcmid-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();

      const requestId = `req-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("availability_request")
        .values({
          id: requestId,
          created_by: userId,
          date_from: "2026-08-01",
          date_to: "2026-08-08",
          status: "open",
        })
        .execute();
      await ctx.db
        .insertInto("availability_fixture")
        .values({
          id: `fix-${crypto.randomUUID()}`,
          availability_request_id: requestId,
          match_date: "2026-08-01",
          play_cricket_match_id: `pcm-${crypto.randomUUID()}`,
          play_cricket_team_id: teamId,
          opposition: "Friendly CC",
          is_home: true,
        })
        .execute();

      await expect(
        createMatchday(ctx.db)(userId, "admin", {
          teamId,
          matchDate: "2026-08-01",
          opposition: "Friendly CC",
        }),
      ).rejects.toThrow("availability request is still open");
    });
  });

  describe("addPlayer / removePlayer", () => {
    it("adds and removes a member player", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `addplayer-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });
      const memberId = await seedMember(
        "Test Player",
        `tp-${crypto.randomUUID()}@test.com`,
      );

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Test Player" },
      );
      expect(playerId).toBeDefined();

      // Verify player exists
      const players = await ctx.db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .selectAll()
        .execute();
      expect(players).toHaveLength(1);
      expect(players[0].player_name).toBe("Test Player");

      // Remove
      const result = await removePlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        playerId,
      );
      expect(result.success).toBe(true);

      const remaining = await ctx.db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .selectAll()
        .execute();
      expect(remaining).toHaveLength(0);
    });

    it("adds an ad-hoc player (creates guest member)", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `adhoc-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { playerName: "Guest Player" },
      );
      expect(playerId).toBeDefined();

      // Should have created a guest member
      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      const memberId = player?.member_id;
      expect(memberId).toBeDefined();

      if (memberId) {
        const member = await ctx.db
          .selectFrom("member")
          .where("id", "=", memberId)
          .selectAll()
          .executeTakeFirst();
        expect(member?.member_category).toBe("guest");
        // Guests have no real contact details — confirm NULL rather than ""
        // so we don't collide on the partial member_email_unique index.
        expect(member?.email).toBeNull();
      }
    });

    it("allows adding two ad-hoc players without colliding on email", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `adhoc-dup-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      await expect(
        addPlayer(ctx.db)(userId, "admin", matchdayId, {
          playerName: "Guest One",
        }),
      ).resolves.toBeDefined();
      await expect(
        addPlayer(ctx.db)(userId, "admin", matchdayId, {
          playerName: "Guest Two",
        }),
      ).resolves.toBeDefined();
    });

    it("adds a junior dependent without creating a guest member row", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `adhoc-dep-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const parentId = await seedMember(
        "Junior Parent",
        `parent-${crypto.randomUUID()}@test.com`,
      );
      const dependentId = `dep-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("dependent")
        .values({
          id: dependentId,
          member_id: parentId,
          name: "Junior Child",
          sex: "f",
          dob: "2014-04-01",
        })
        .execute();

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { dependentId, playerName: "Junior Child" },
      );

      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      expect(player?.dependent_id).toBe(dependentId);
      // Juniors should not synthesise a guest member row — they point
      // straight at the existing dependent.
      expect(player?.member_id).toBeNull();
    });
  });

  describe("searchMembers", () => {
    it("finds members by name (case insensitive)", async () => {
      const name = `SearchTest-${crypto.randomUUID().slice(0, 6)}`;
      await seedMember(name, `${name.toLowerCase()}@test.com`);

      const result = await searchMembers(ctx.db)({ query: name.slice(0, 8) });
      expect(result.some((m) => m.name === name)).toBe(true);
    });
  });

  describe("finishMatch with fee generation", () => {
    it("finishes the match and generates match fees", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `confirm-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });
      const memberId = await seedMember(
        "Fee Player",
        `fee-${crypto.randomUUID()}@test.com`,
        "senior",
      );

      // Add a fee rate for seniors
      await seedFeeRate({ memberCategory: "senior", amountPence: 500 });

      // Add player
      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Fee Player" },
      );

      // Wrap up with player as "playing"
      await finishAsTest(matchdayId, userId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });

      const md = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(md?.status).toBe("finished");

      // Verify charge was created
      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      const chargeId = player?.charge_id;
      expect(chargeId).toBeDefined();

      if (chargeId) {
        const charge = await ctx.db
          .selectFrom("charge")
          .where("id", "=", chargeId)
          .selectAll()
          .executeTakeFirst();
        expect(charge?.amount_pence).toBe(500);
        expect(charge?.type).toBe("match_fee");
      }
    });

    it("sends a push notification when the recipient prefers push", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `push-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const playerEmail = `push-player-${crypto.randomUUID()}@test.com`;
      const { userId: playerUserId, memberId } = await seedTestUser(ctx.db, {
        email: playerEmail,
        name: "Push Player",
      });
      if (!memberId) throw new Error("expected memberId");
      // seedTestUser inserts a member without a category; finishMatch's
      // fee resolver keys on member_category so set it explicitly.
      await ctx.db
        .updateTable("member")
        .set({ member_category: "senior" })
        .where("id", "=", memberId)
        .execute();

      await ctx.db
        .insertInto("notification_preferences")
        .values({ user_id: playerUserId, matchday_channel: "push" })
        .execute();

      const endpoint = `https://push.test/${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("push_subscription")
        .values({
          id: crypto.randomUUID(),
          user_id: playerUserId,
          endpoint,
          p256dh: "test-p256dh",
          auth: "test-auth",
        })
        .execute();

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      await seedFeeRate({ teamId, memberCategory: "senior", amountPence: 500 });

      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Push Player" },
      );

      const pushCalls: Array<{ endpoint: string; payload: unknown }> = [];
      const emailCalls: Array<{ to: string }> = [];
      const recordingSendPush: SendPush = (sub, payload) => {
        pushCalls.push({ endpoint: sub.endpoint, payload });
        return Promise.resolve({ ok: true, endpoint: sub.endpoint });
      };
      const recordingSendEmail = (e: {
        to: string;
        subject: string;
        html: string;
      }) => {
        emailCalls.push({ to: e.to });
        return Promise.resolve();
      };

      // Wrapping up only creates the charge - no notifications yet.
      await finishAsTest(matchdayId, adminId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });
      expect(pushCalls).toHaveLength(0);
      expect(emailCalls).toHaveLength(0);

      // The captain then sends the donation-request batch.
      const result = await notifyAsTest(matchdayId, adminId, {
        sendEmail: recordingSendEmail,
        sendPush: recordingSendPush,
      });

      expect(result.success).toBe(true);
      expect(result.emailsSent).toBe(1);
      expect(emailCalls).toHaveLength(0);
      expect(pushCalls).toHaveLength(1);
      expect(pushCalls[0]?.endpoint).toBe(endpoint);
      const payload = pushCalls[0]?.payload as {
        title: string;
        body: string;
        url: string;
        tag: string;
      };
      expect(payload.title).toBeTruthy();
      expect(payload.body).toContain("£5.00");
      expect(payload.tag.startsWith("charge:")).toBe(true);

      // One-shot: a second batch is refused.
      await expect(notifyAsTest(matchdayId, adminId)).rejects.toThrow(
        "Donation requests have already been sent",
      );
    });

    it("skips players marked paid before the donation batch is sent", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `notify-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const paidEmail = `paid-${crypto.randomUUID()}@test.com`;
      const unpaidEmail = `unpaid-${crypto.randomUUID()}@test.com`;
      const paidMemberId = await seedMember("Paid Player", paidEmail, "senior");
      const unpaidMemberId = await seedMember(
        "Unpaid Player",
        unpaidEmail,
        "senior",
      );

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      await seedFeeRate({ teamId, memberCategory: "senior", amountPence: 500 });

      const { id: paidPlayerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId: paidMemberId, playerName: "Paid Player" },
      );
      const { id: unpaidPlayerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId: unpaidMemberId, playerName: "Unpaid Player" },
      );

      await finishAsTest(matchdayId, adminId, {
        playerStatuses: [
          { matchdayPlayerId: paidPlayerId, status: "playing" },
          { matchdayPlayerId: unpaidPlayerId, status: "playing" },
        ],
      });

      // Captain collects cash from one player on the day, before notifying.
      await markFeePaid(ctx.db)(adminId, "admin", matchdayId, paidPlayerId, {
        paymentMethod: "cash",
      });

      const emailCalls: Array<{ to: string }> = [];
      const result = await notifyAsTest(matchdayId, adminId, {
        sendEmail: (e) => {
          emailCalls.push({ to: e.to });
          return Promise.resolve();
        },
      });

      // Only the still-unpaid player is emailed.
      expect(result.emailsSent).toBe(1);
      expect(emailCalls).toHaveLength(1);
      expect(emailCalls[0]?.to).toBe(unpaidEmail);
    });

    it("refuses to notify before the match is wrapped up", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `early-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });

      await expect(notifyAsTest(matchdayId, adminId)).rejects.toThrow(
        "Wrap up the match before sending donation requests",
      );
    });

    it("only one of two concurrent notify calls delivers the batch", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `race-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const playerEmail = `race-player-${crypto.randomUUID()}@test.com`;
      const memberId = await seedMember("Race Player", playerEmail, "senior");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      await seedFeeRate({ teamId, memberCategory: "senior", amountPence: 500 });

      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Race Player" },
      );
      await finishAsTest(matchdayId, adminId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });

      const emailCalls: Array<{ to: string }> = [];
      const recordingSendEmail = (e: { to: string }) => {
        emailCalls.push({ to: e.to });
        return Promise.resolve();
      };

      // Fire both at once. The up-front conditional claim serialises them:
      // exactly one stamps the row and delivers, the other updates zero
      // rows and rejects - so the player is emailed once, not twice.
      const settled = await Promise.allSettled([
        notifyAsTest(matchdayId, adminId, { sendEmail: recordingSendEmail }),
        notifyAsTest(matchdayId, adminId, { sendEmail: recordingSendEmail }),
      ]);

      const fulfilled = settled.filter((s) => s.status === "fulfilled");
      const rejected = settled.filter((s) => s.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(emailCalls).toHaveLength(1);
      expect(emailCalls[0]?.to).toBe(playerEmail);
    });

    it("raises a junior-rate charge against the parent when a dependent plays", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `junior-fee-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const parentId = await seedMember(
        "Fee Parent",
        `fee-parent-${crypto.randomUUID()}@test.com`,
        "senior",
      );
      const dependentId = `dep-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("dependent")
        .values({
          id: dependentId,
          member_id: parentId,
          name: "Junior Player",
          sex: "m",
          dob: "2013-06-01",
        })
        .execute();

      await seedFeeRate({ memberCategory: "junior", amountPence: 200 });

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { dependentId, playerName: "Junior Player" },
      );

      await finishAsTest(matchdayId, userId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });

      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      const chargeId = player?.charge_id;
      expect(chargeId).toBeDefined();
      if (!chargeId) return;

      const charge = await ctx.db
        .selectFrom("charge")
        .where("id", "=", chargeId)
        .selectAll()
        .executeTakeFirst();
      expect(charge?.amount_pence).toBe(200);
      expect(charge?.type).toBe("match_fee");
      // Charge belongs to the parent, not the dependent
      expect(charge?.member_id).toBe(parentId);
      // Description includes the junior's name so the parent can tell
      // children apart when multiple are registered.
      expect(charge?.description).toContain("Junior Player");

      // charge_dependent link is created so the parent's portal can
      // attribute the donation to the correct child.
      const link = await ctx.db
        .selectFrom("charge_dependent")
        .where("charge_id", "=", chargeId)
        .selectAll()
        .executeTakeFirst();
      expect(link?.dependent_id).toBe(dependentId);
    });

    it("treats a team with no team-scoped fee rates as fee-free even when a global rate exists", async () => {
      // Women's softball case: the club deliberately leaves no
      // match_fee_rate row for the team. A global (null-team) default
      // rate exists for the player's category, but it must NOT raise a
      // charge here - that's the bug codex flagged. The team having no
      // own rates is the signal that it's fee-free.
      const { userId } = await seedTestUser(ctx.db, {
        email: `nofees-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });
      // Stamp a unique competition_type so the global rate below is
      // uniquely scoped (the unique constraint on match_fee_rate covers
      // (team, competition, category)).
      const competitionType = `FeeFreeTest-${crypto.randomUUID().slice(0, 8)}`;
      await ctx.db
        .updateTable("matchday")
        .set({ competition_type: competitionType })
        .where("id", "=", matchdayId)
        .execute();
      const memberId = await seedMember(
        "Free Player",
        `free-${crypto.randomUUID()}@test.com`,
        "senior",
      );

      // Global null-team senior rate exists for this competition -
      // mirrors the production null-team guest default. The fee-free
      // team must still skip it.
      await seedFeeRate({
        competitionType,
        memberCategory: "senior",
        amountPence: 1000,
      });

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Free Player" },
      );

      await finishAsTest(matchdayId, userId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });

      const md = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(md?.status).toBe("finished");

      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .selectAll()
        .executeTakeFirst();
      expect(player?.charge_id).toBeNull();
    });
  });

  describe("markFeePaid", () => {
    it("marks an outstanding match fee as paid after the match is finished", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `markpaid-finished-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });
      const memberId = await seedMember(
        "Late Payer",
        `late-${crypto.randomUUID()}@test.com`,
        "senior",
      );

      await seedFeeRate({ teamId, memberCategory: "senior", amountPence: 700 });

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Late Payer" },
      );

      await finishAsTest(matchdayId, userId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });

      // Move matchday to "finished" without going through finishMatch
      // (avoids pulling in the email/render imports for this test).
      await ctx.db
        .updateTable("matchday")
        .set({
          status: "finished",
          finished_at: new Date().toISOString(),
          finished_by: userId,
          result_type: "W",
        })
        .where("id", "=", matchdayId)
        .execute();

      const result = await markFeePaid(ctx.db)(
        userId,
        "admin",
        matchdayId,
        playerId,
        { paymentMethod: "cash" },
      );

      expect(result.success).toBe(true);

      const player = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .select(["charge_id"])
        .executeTakeFirst();

      const charge = await ctx.db
        .selectFrom("charge")
        .where("id", "=", player?.charge_id ?? "")
        .selectAll()
        .executeTakeFirst();

      expect(charge?.paid_at).not.toBeNull();
      expect(charge?.payment_method).toBe("cash");
    });
  });

  describe("getMatch (enriched)", () => {
    it("returns matchday with players, expenses, and team", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `getmatch-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const result = await getMatch(ctx.db)(userId, "admin", matchdayId);

      expect(result.matchday.id).toBe(matchdayId);
      expect(result.team).toBeTruthy();
      expect(result.players).toBeDefined();
      expect(result.expenses).toBeDefined();
    });
  });

  describe("recordExpense / deleteExpense", () => {
    it("creates and then deletes an expense record", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `expense-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchId = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "confirmed",
      });

      // Record expense (no S3 in integration tests)
      const { expenseId } = await recordExpense(ctx.db, s3)(userId, "admin", {
        matchId,
        type: "umpire_fee",
        description: "Umpire payment",
        amountPence: 5000,
      });

      // Verify it exists
      const row = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(row).toBeTruthy();
      expect(row?.expense_type).toBe("umpire_fee");
      expect(row?.amount_pence).toBe(5000);

      // Delete
      const deleteResult = await deleteExpense(ctx.db)(
        userId,
        "admin",
        expenseId,
      );
      expect(deleteResult.success).toBe(true);

      // Verify deletion
      const deleted = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(deleted).toBeUndefined();
    });
  });

  describe("expense approval workflow", () => {
    it("full lifecycle: submit → approve → reimburse", async () => {
      const { userId: officialId } = await seedTestUser(ctx.db, {
        email: `official-expense-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `admin-expense-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      await seedTeamOfficial(officialId, teamId);
      const matchId = await seedMatchday({
        teamId,
        createdBy: officialId,
        status: "confirmed",
      });

      // 1. Submit expense claim
      const { expenseId } = await submitExpenseClaim(ctx.db, s3)(
        officialId,
        "official",
        {
          matchId,
          type: "umpire_fee",
          description: "Umpire fee for match",
          amountPence: 5000,
        },
      );

      // Verify submitted status
      let expense = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(expense?.status).toBe("submitted");
      expect(expense?.submitted_at).toBeTruthy();

      // 2. Approve
      await approveExpense(ctx.db)(adminId, expenseId);

      expense = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(expense?.status).toBe("approved");
      expect(expense?.approved_by).toBe(adminId);
      expect(expense?.approved_at).toBeTruthy();

      // 3. Reimburse
      await markExpenseReimbursed(ctx.db)(adminId, expenseId);

      expense = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(expense?.status).toBe("reimbursed");
      expect(expense?.reimbursed_by).toBe(adminId);
      expect(expense?.reimbursed_at).toBeTruthy();
    });

    it("submit → reject with reason", async () => {
      const { userId: officialId } = await seedTestUser(ctx.db, {
        email: `off-reject-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `adm-reject-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      await seedTeamOfficial(officialId, teamId);
      const matchId = await seedMatchday({
        teamId,
        createdBy: officialId,
        status: "confirmed",
      });

      const { expenseId } = await submitExpenseClaim(ctx.db, s3)(
        officialId,
        "official",
        {
          matchId,
          type: "teas",
          amountPence: 3000,
        },
      );

      await rejectExpense(ctx.db)(adminId, expenseId, {
        reason: "No receipt attached",
      });

      const expense = await ctx.db
        .selectFrom("matchday_expense")
        .where("id", "=", expenseId)
        .selectAll()
        .executeTakeFirst();
      expect(expense?.status).toBe("rejected");
      expect(expense?.rejected_reason).toBe("No receipt attached");
    });

    it("cannot approve a non-submitted expense", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `adm-invalid-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchId = await seedMatchday({
        teamId,
        createdBy: adminId,
        status: "confirmed",
      });

      // Create a draft expense via recordExpense (no receipt, no S3 needed)
      const { expenseId } = await recordExpense(ctx.db, s3)(adminId, "admin", {
        matchId,
        type: "match_ball",
        amountPence: 2000,
      });

      await expect(approveExpense(ctx.db)(adminId, expenseId)).rejects.toThrow(
        "Only submitted expenses can be approved",
      );
    });

    it("cannot reimburse a non-approved expense", async () => {
      const { userId: officialId } = await seedTestUser(ctx.db, {
        email: `off-noreimb-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `adm-noreimb-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      await seedTeamOfficial(officialId, teamId);
      const matchId = await seedMatchday({
        teamId,
        createdBy: officialId,
        status: "confirmed",
      });

      const { expenseId } = await submitExpenseClaim(ctx.db, s3)(
        officialId,
        "official",
        {
          matchId,
          type: "scorer_fee",
          amountPence: 2500,
        },
      );

      // Try to reimburse without approval
      await expect(
        markExpenseReimbursed(ctx.db)(adminId, expenseId),
      ).rejects.toThrow("Only approved expenses can be reimbursed");
    });

    it("listPendingExpenses returns submitted and approved expenses", async () => {
      const { userId: officialId } = await seedTestUser(ctx.db, {
        email: `off-pending-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `adm-pending-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      await seedTeamOfficial(officialId, teamId);
      const matchId = await seedMatchday({
        teamId,
        createdBy: officialId,
        status: "confirmed",
      });

      // Submit two expenses
      const { expenseId: exp1 } = await submitExpenseClaim(ctx.db, s3)(
        officialId,
        "official",
        { matchId, type: "umpire_fee", amountPence: 5000 },
      );
      await submitExpenseClaim(ctx.db, s3)(officialId, "official", {
        matchId,
        type: "teas",
        amountPence: 3000,
      });

      // Approve the first one
      await approveExpense(ctx.db)(adminId, exp1);

      // List all pending (submitted + approved)
      const result = await listPendingExpenses(ctx.db)({
        limit: 50,
        offset: 0,
      });

      const expenseIds = result.items.map((e) => e.id);
      expect(expenseIds).toContain(exp1);
      expect(result.items.length).toBeGreaterThanOrEqual(2);

      // Filter by submitted only
      const submitted = await listPendingExpenses(ctx.db)({
        status: "submitted",
        limit: 50,
        offset: 0,
      });
      for (const item of submitted.items) {
        expect(item.status).toBe("submitted");
      }
    });
  });

  describe("cancelMatchday", () => {
    it("cancels a pending matchday and records the reason", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cancel-pending-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const result = await cancelMatchday(ctx.db)(userId, "admin", matchdayId, {
        reason: "Rained off",
      });

      expect(result.success).toBe(true);

      const md = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(md?.status).toBe("cancelled");
      expect(md?.cancelled_at).not.toBeNull();
      expect(md?.cancelled_by).toBe(userId);
      expect(md?.cancelled_reason).toBe("Rained off");
    });

    it("cancels a pending matchday when no charges exist", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cancel-pending-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      const result = await cancelMatchday(ctx.db)(
        userId,
        "admin",
        matchdayId,
        {},
      );
      expect(result.success).toBe(true);

      const after = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(after?.status).toBe("cancelled");
    });

    it("blocks cancel when an active match-fee charge already exists", async () => {
      // Under the amended flow charges only exist post-wrap, but the
      // safety net stays in place against manual / data-fix scenarios.
      const { userId } = await seedTestUser(ctx.db, {
        email: `cancel-blocked-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });
      const memberId = await seedMember(
        "Paying Player",
        `paying-${crypto.randomUUID()}@test.com`,
        "senior",
      );

      const { id: playerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Paying Player" },
      );

      // Inject an outstanding charge directly to simulate a half-state.
      const chargeId = crypto.randomUUID();
      await ctx.db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: memberId,
          description: "Stray match donation",
          amount_pence: 500,
          charge_date: "2026-05-01",
          created_by: userId,
          type: "match_fee",
          source: "matchday",
        })
        .execute();
      await ctx.db
        .updateTable("matchday_player")
        .set({ charge_id: chargeId })
        .where("id", "=", playerId)
        .execute();

      await expect(
        cancelMatchday(ctx.db)(userId, "admin", matchdayId, {}),
      ).rejects.toThrow("Cannot cancel");
    });

    it("rejects cancelling a finished matchday", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cancel-finished-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "finished",
      });

      await expect(
        cancelMatchday(ctx.db)(userId, "admin", matchdayId, {}),
      ).rejects.toThrow("finished matchday");
    });

    it("createMatchday allows re-using the date of a cancelled matchday", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `cancel-recreate-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();
      const matchDate = "2026-08-12";

      // First matchday on this date → cancel it
      const firstId = await seedMatchday({
        teamId,
        createdBy: userId,
        matchDate,
      });
      await cancelMatchday(ctx.db)(userId, "admin", firstId, {});

      // Now re-create on the same date — should succeed
      const result = await createMatchday(ctx.db)(userId, "admin", {
        teamId,
        matchDate,
        opposition: "Rescheduled CC",
      });
      expect(result.id).toBeDefined();
      expect(result.id).not.toBe(firstId);
    });
  });

  describe("getPastUnfinishedMatchdays", () => {
    it("returns only pending/confirmed matchdays whose date is in the past", async () => {
      const { userId } = await seedTestUser(ctx.db, {
        email: `past-unfinished-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });
      const teamId = await seedTeam();

      // Past pending — should show
      const pastPending = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "pending",
        matchDate: "2026-04-01",
      });
      // Past confirmed — should show
      const pastConfirmed = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "confirmed",
        matchDate: "2026-04-15",
      });
      // Past finished — should NOT show
      const pastFinished = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "finished",
        matchDate: "2026-04-20",
      });
      // Future pending — should NOT show
      const futurePending = await seedMatchday({
        teamId,
        createdBy: userId,
        status: "pending",
        matchDate: "2099-01-01",
      });

      const result = await getPastUnfinishedMatchdays(ctx.db)(
        userId,
        "admin",
        teamId,
      );

      const ids = result.map((m) => m.id);
      expect(ids).toContain(pastPending);
      expect(ids).toContain(pastConfirmed);
      expect(ids).not.toContain(pastFinished);
      expect(ids).not.toContain(futurePending);
    });

    it("rejects access to a team the official does not officiate", async () => {
      const { userId: outsiderId } = await seedTestUser(ctx.db, {
        email: `outsider-${crypto.randomUUID()}@test.com`,
        role: "official",
      });
      const teamId = await seedTeam();

      await expect(
        getPastUnfinishedMatchdays(ctx.db)(outsiderId, "official", teamId),
      ).rejects.toThrow("do not have access");
    });
  });

  describe("getMyUpcomingMatches with dependents", () => {
    it("includes a dependent's selection alongside the member's own", async () => {
      const email = `parent-upcoming-${crypto.randomUUID()}@test.com`;
      const { userId, memberId } = await seedTestUser(ctx.db, { email });
      if (!memberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: userId });

      // Parent's own selection.
      const { id: ownPlayerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { memberId, playerName: "Parent Player" },
      );

      // Dependent's selection on the same matchday.
      const dependentId = `dep-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("dependent")
        .values({
          id: dependentId,
          member_id: memberId,
          name: "Junior Kid",
          sex: "m",
          dob: "2015-03-02",
        })
        .execute();
      const { id: depPlayerId } = await addPlayer(ctx.db)(
        userId,
        "admin",
        matchdayId,
        { dependentId, playerName: "Junior Kid" },
      );

      const rows = await getMyUpcomingMatches(ctx.db)(email);
      const own = rows.find((r) => r.matchdayPlayerId === ownPlayerId);
      const dep = rows.find((r) => r.matchdayPlayerId === depPlayerId);

      expect(own?.forDependent).toBe(false);
      expect(own?.dependentName).toBeNull();
      expect(dep?.forDependent).toBe(true);
      expect(dep?.dependentName).toBe("Junior Kid");
    });
  });

  describe("withdrawFromMatch", () => {
    // Seed a captain on the matchday so the notification path has a
    // recipient. Returns the captain's email and member id.
    async function seedCaptain(matchdayId: string, adminId: string) {
      const captainEmail = `captain-${crypto.randomUUID()}@test.com`;
      const captainMemberId = await seedMember("Skip Captain", captainEmail);
      const { id: captainPlayerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId: captainMemberId, playerName: "Skip Captain" },
      );
      await ctx.db
        .updateTable("matchday_player")
        .set({ is_captain: true })
        .where("id", "=", captainPlayerId)
        .execute();
      return { captainEmail, captainMemberId, captainPlayerId };
    }

    it("withdraws the member's own selection and notifies the captain", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const email = `wd-player-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, {
        email,
        name: "Drop Player",
      });
      if (!memberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      await seedCaptain(matchdayId, adminId);
      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Drop Player" },
      );

      const emails: Array<{ to: string; subject: string }> = [];
      const result = await withdrawAsTest(email, playerId, {
        sendEmail: (e) => {
          emails.push({ to: e.to, subject: e.subject });
          return Promise.resolve();
        },
      });

      expect(result.success).toBe(true);
      const row = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .select("status")
        .executeTakeFirst();
      expect(row?.status).toBe("withdrawn");
      // Captain (the only push-less recipient) was emailed.
      expect(emails.length).toBe(1);
    });

    it("lets a parent withdraw their dependent", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin2-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const parentEmail = `wd-parent-${crypto.randomUUID()}@test.com`;
      const { memberId: parentMemberId } = await seedTestUser(ctx.db, {
        email: parentEmail,
        name: "Drop Parent",
      });
      if (!parentMemberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      await seedCaptain(matchdayId, adminId);

      const dependentId = `dep-${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("dependent")
        .values({
          id: dependentId,
          member_id: parentMemberId,
          name: "Drop Kid",
          sex: "f",
          dob: "2016-01-01",
        })
        .execute();
      const { id: depPlayerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { dependentId, playerName: "Drop Kid" },
      );

      const result = await withdrawAsTest(parentEmail, depPlayerId);
      expect(result.success).toBe(true);
      const row = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", depPlayerId)
        .select("status")
        .executeTakeFirst();
      expect(row?.status).toBe("withdrawn");
    });

    it("rejects withdrawing someone else's selection", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin3-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const ownerEmail = `wd-owner-${crypto.randomUUID()}@test.com`;
      const { memberId: ownerMemberId } = await seedTestUser(ctx.db, {
        email: ownerEmail,
      });
      if (!ownerMemberId) throw new Error("expected memberId");
      const intruderEmail = `wd-intruder-${crypto.randomUUID()}@test.com`;
      await seedTestUser(ctx.db, { email: intruderEmail });

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId: ownerMemberId, playerName: "Owner" },
      );

      await expect(withdrawAsTest(intruderEmail, playerId)).rejects.toThrow(
        "your own games",
      );
      const row = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .select("status")
        .executeTakeFirst();
      expect(row?.status).toBe("selected");
    });

    it("rejects dropout once the match date has passed", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin4-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const email = `wd-late-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });
      if (!memberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({
        teamId,
        createdBy: adminId,
        matchDate: "2020-01-01",
      });
      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Late Player" },
      );

      await expect(withdrawAsTest(email, playerId)).rejects.toThrow(
        "already taken place",
      );
    });

    it("rejects dropout once the matchday is cancelled, leaving the selection intact", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin-cxl-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const email = `wd-cxl-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });
      if (!memberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Cancelled Player" },
      );
      // Make the player a captain so we can assert the role flag survives a
      // rejected dropout (the atomic claim clears flags, so a leak here would
      // strip the captaincy off a still-selected player).
      await ctx.db
        .updateTable("matchday_player")
        .set({ is_captain: true })
        .where("id", "=", playerId)
        .execute();

      // An official cancels the matchday. The dropout must now be rejected -
      // and must not flip the selection to withdrawn or clear its flags -
      // even though the player row itself is still "selected". This is the
      // guard the conditional claim enforces against a concurrent cancel.
      await ctx.db
        .updateTable("matchday")
        .set({ status: "cancelled" })
        .where("id", "=", matchdayId)
        .execute();

      await expect(withdrawAsTest(email, playerId)).rejects.toThrow(
        "no longer open for changes",
      );
      const row = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .select(["status", "is_captain"])
        .executeTakeFirst();
      expect(row?.status).toBe("selected");
      expect(row?.is_captain).toBe(true);
    });

    it("rejects a second dropout on an already-withdrawn selection", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin5-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const email = `wd-twice-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });
      if (!memberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      await seedCaptain(matchdayId, adminId);
      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Twice Player" },
      );

      await withdrawAsTest(email, playerId);
      await expect(withdrawAsTest(email, playerId)).rejects.toThrow(
        "not currently selected",
      );
    });

    it("pushes to a captain who prefers push notifications", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin6-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const email = `wd-pusher-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email });
      if (!memberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });

      // Captain has a user account, a push preference, and a subscription.
      const captainEmail = `wd-captain-push-${crypto.randomUUID()}@test.com`;
      const { userId: captainUserId } = await seedTestUser(ctx.db, {
        email: captainEmail,
        name: "Push Captain",
      });
      const { id: captainPlayerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId: `member-${captainUserId}`, playerName: "Push Captain" },
      );
      await ctx.db
        .updateTable("matchday_player")
        .set({ is_captain: true })
        .where("id", "=", captainPlayerId)
        .execute();
      await ctx.db
        .insertInto("notification_preferences")
        .values({ user_id: captainUserId, matchday_channel: "push" })
        .execute();
      const endpoint = `https://push.test/${crypto.randomUUID()}`;
      await ctx.db
        .insertInto("push_subscription")
        .values({
          id: crypto.randomUUID(),
          user_id: captainUserId,
          endpoint,
          p256dh: "test-p256dh",
          auth: "test-auth",
        })
        .execute();

      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Dropper" },
      );

      const pushed: string[] = [];
      const emails: string[] = [];
      await withdrawAsTest(email, playerId, {
        sendEmail: (e) => {
          emails.push(e.to);
          return Promise.resolve();
        },
        sendPush: (sub) => {
          pushed.push(sub.endpoint);
          return Promise.resolve({ ok: true, endpoint: sub.endpoint });
        },
      });

      expect(pushed).toContain(endpoint);
      // Push-preferring captain with a live subscription is not also emailed.
      expect(emails.length).toBe(0);
    });

    it("clears the captain flag when a captain drops themselves out", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin7-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const email = `wd-skipper-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, {
        email,
        name: "Self Captain",
      });
      if (!memberId) throw new Error("expected memberId");

      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });
      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Self Captain" },
      );
      await ctx.db
        .updateTable("matchday_player")
        .set({ is_captain: true, is_wicketkeeper: true })
        .where("id", "=", playerId)
        .execute();

      await withdrawAsTest(email, playerId);

      const row = await ctx.db
        .selectFrom("matchday_player")
        .where("id", "=", playerId)
        .select(["status", "is_captain", "is_wicketkeeper"])
        .executeTakeFirst();
      expect(row?.status).toBe("withdrawn");
      expect(row?.is_captain).toBe(false);
      expect(row?.is_wicketkeeper).toBe(false);

      // And the withdrawal drops it out of the upcoming-games card.
      const upcoming = await getMyUpcomingMatches(ctx.db)(email);
      expect(upcoming.some((u) => u.matchdayPlayerId === playerId)).toBe(false);
    });

    it("notifies every team official and the captain", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin8-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });

      // Two officials assigned to the team.
      const off1 = await seedTestUser(ctx.db, {
        email: `wd-off1-${crypto.randomUUID()}@test.com`,
        name: "Off One",
      });
      const off2 = await seedTestUser(ctx.db, {
        email: `wd-off2-${crypto.randomUUID()}@test.com`,
        name: "Off Two",
      });
      await seedTeamOfficial(off1.userId, teamId);
      await seedTeamOfficial(off2.userId, teamId);

      // A captain who is not an assigned official.
      const captainEmail = `wd-cap-${crypto.randomUUID()}@test.com`;
      const captainMemberId = await seedMember("Cap Tain", captainEmail);
      const { id: captainPlayerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId: captainMemberId, playerName: "Cap Tain" },
      );
      await ctx.db
        .updateTable("matchday_player")
        .set({ is_captain: true })
        .where("id", "=", captainPlayerId)
        .execute();

      const dropEmail = `wd-drop-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email: dropEmail });
      if (!memberId) throw new Error("expected memberId");
      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId, playerName: "Dropper" },
      );

      const recipients: string[] = [];
      await withdrawAsTest(dropEmail, playerId, {
        sendEmail: (e) => {
          recipients.push(e.to.toLowerCase());
          return Promise.resolve();
        },
      });

      expect(recipients).toContain(off1.email.toLowerCase());
      expect(recipients).toContain(off2.email.toLowerCase());
      expect(recipients).toContain(captainEmail.toLowerCase());
      expect(recipients).not.toContain(dropEmail.toLowerCase());
    });

    it("does not notify the dropping player even when they are an official", async () => {
      const { userId: adminId } = await seedTestUser(ctx.db, {
        email: `wd-admin9-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: adminId });

      // The dropping player is also a team official.
      const dropEmail = `wd-selfoff-${crypto.randomUUID()}@test.com`;
      const dropper = await seedTestUser(ctx.db, { email: dropEmail });
      if (!dropper.memberId) throw new Error("expected memberId");
      await seedTeamOfficial(dropper.userId, teamId);

      // A second official who should still be told.
      const otherOff = await seedTestUser(ctx.db, {
        email: `wd-otheroff-${crypto.randomUUID()}@test.com`,
      });
      await seedTeamOfficial(otherOff.userId, teamId);

      const { id: playerId } = await addPlayer(ctx.db)(
        adminId,
        "admin",
        matchdayId,
        { memberId: dropper.memberId, playerName: "Self Official" },
      );

      const recipients: string[] = [];
      await withdrawAsTest(dropEmail, playerId, {
        sendEmail: (e) => {
          recipients.push(e.to.toLowerCase());
          return Promise.resolve();
        },
      });

      expect(recipients).toContain(otherOff.email.toLowerCase());
      expect(recipients).not.toContain(dropEmail.toLowerCase());
    });

    it("notifies club-wide matchday_admins but not general admins", async () => {
      const { userId: creatorId } = await seedTestUser(ctx.db, {
        email: `wd-creator-${crypto.randomUUID()}@test.com`,
        role: "admin",
        withMember: false,
      });
      const teamId = await seedTeam();
      const matchdayId = await seedMatchday({ teamId, createdBy: creatorId });

      // Club-wide gameday admin, with no team_official assignment.
      const mdAdmin = await seedTestUser(ctx.db, {
        email: `wd-mdadmin-${crypto.randomUUID()}@test.com`,
        role: "matchday_admin",
        name: "MD Admin",
      });
      // A general admin who should NOT be pulled in.
      const genAdmin = await seedTestUser(ctx.db, {
        email: `wd-genadmin-${crypto.randomUUID()}@test.com`,
        role: "admin",
      });

      const dropEmail = `wd-drop2-${crypto.randomUUID()}@test.com`;
      const { memberId } = await seedTestUser(ctx.db, { email: dropEmail });
      if (!memberId) throw new Error("expected memberId");
      const { id: playerId } = await addPlayer(ctx.db)(
        creatorId,
        "admin",
        matchdayId,
        { memberId, playerName: "Dropper" },
      );

      const recipients: string[] = [];
      await withdrawAsTest(dropEmail, playerId, {
        sendEmail: (e) => {
          recipients.push(e.to.toLowerCase());
          return Promise.resolve();
        },
      });

      expect(recipients).toContain(mdAdmin.email.toLowerCase());
      expect(recipients).not.toContain(genAdmin.email.toLowerCase());
    });
  });
});
