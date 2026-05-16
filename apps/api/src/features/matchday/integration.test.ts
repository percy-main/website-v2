import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  getPastUnfinishedMatchdays,
  listMatches,
  listPendingExpenses,
  listTeams,
  markExpenseReimbursed,
  markFeePaid,
  recordExpense,
  rejectExpense,
  removePlayer,
  searchMembers,
  submitExpenseClaim,
} from "./service.ts";

const noopSendEmail = () => Promise.resolve();
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
  const { createNoopLogger } = await import("../../lib/worker-logger.ts");
  return finishMatch(ctx.db, noopSendEmail, testConfig)(
    userId,
    "admin",
    matchdayId,
    {
      resultType: data.resultType ?? "W",
      playerStatuses: data.playerStatuses ?? [],
      feeOverrides: data.feeOverrides ?? [],
    },
    createNoopLogger(),
  );
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
});
