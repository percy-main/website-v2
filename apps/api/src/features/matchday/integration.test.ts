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
  confirmTeam,
  createMatchday,
  deleteExpense,
  getMatch,
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
      }
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

  describe("confirmTeam with fee generation", () => {
    it("confirms team and generates match fees", async () => {
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

      // Confirm with player as "playing"
      await confirmTeam(ctx.db)(userId, "admin", matchdayId, {
        playerStatuses: [{ matchdayPlayerId: playerId, status: "playing" }],
      });

      // Verify matchday is confirmed
      const md = await ctx.db
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .selectAll()
        .executeTakeFirst();
      expect(md?.status).toBe("confirmed");

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

      await confirmTeam(ctx.db)(userId, "admin", matchdayId, {
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
});
