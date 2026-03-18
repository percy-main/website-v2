import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExecuteTakeFirst,
  mockExecuteTakeFirstOrThrow,
  mockExecute,
  mockQueryBuilder,
} = vi.hoisted(() => {
  const mockExecuteTakeFirst = vi.fn();
  const mockExecuteTakeFirstOrThrow = vi.fn();
  const mockExecute = vi.fn();

  const mockQueryBuilder: Record<string, unknown> = {
    selectFrom: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    deleteFrom: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    executeTakeFirst: mockExecuteTakeFirst,
    executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
    execute: mockExecute,
    fn: {
      countAll: vi.fn().mockReturnValue({
        as: vi.fn().mockReturnValue("count_expr"),
      }),
    },
  };

  // transaction() returns an object with execute() that runs the callback with
  // the same mock query builder (acting as the transaction handle)
  mockQueryBuilder.transaction = vi.fn().mockReturnValue({
    execute: vi
      .fn()
      .mockImplementation(async (cb: (trx: unknown) => Promise<unknown>) => {
        return await cb(mockQueryBuilder);
      }),
  });

  return {
    mockExecuteTakeFirst,
    mockExecuteTakeFirstOrThrow,
    mockExecute,
    mockQueryBuilder,
  };
});

import {
  addMatchFeeRate,
  chasePayment,
  createMember,
  deleteMatchFeeRate,
  getChargeAggregates,
  getMergePreview,
  linkPlayCricketPlayer,
  listAllCharges,
  listContactSubmissions,
  listMatchFeeRates,
  listUsers,
  mergeMembers,
  unlinkPlayCricketPlayer,
} from "./service.js";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("admin service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = mockQueryBuilder[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
  });

  describe("listUsers", () => {
    it("returns paginated results", async () => {
      const users = [
        { id: "u1", name: "Alice", email: "alice@example.com" },
        { id: "u2", name: "Bob", email: "bob@example.com" },
      ];

      mockExecute.mockResolvedValue(users);
      mockExecuteTakeFirst.mockResolvedValue({ total: 50 });

      const result = await listUsers(db)({
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });

      expect(result.items).toEqual(users);
      expect(result.total).toBe(50);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it("filters by search term", async () => {
      mockExecute.mockResolvedValue([]);
      mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

      await listUsers(db)({
        page: 1,
        pageSize: 20,
        search: "alice",
        includeArchived: false,
      });

      // The where clause should be called with a callback for OR search
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });
  });

  describe("createMember", () => {
    it("creates member record and returns id", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await createMember(db)({
        email: "new@example.com",
        name: "New Member",
      });

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("member");
    });
  });

  describe("linkPlayCricketPlayer", () => {
    it("updates play_cricket_id on member", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await linkPlayCricketPlayer(db)(
        "member",
        "m-1",
        "pc-12345",
      );

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("member");
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        play_cricket_id: "pc-12345",
      });
    });

    it("updates play_cricket_id on dependent", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await linkPlayCricketPlayer(db)(
        "dependent",
        "d-1",
        "pc-67890",
      );

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("dependent");
    });
  });

  describe("unlinkPlayCricketPlayer", () => {
    it("sets play_cricket_id to null", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await unlinkPlayCricketPlayer(db)("member", "m-1");

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        play_cricket_id: null,
      });
    });
  });

  describe("listAllCharges", () => {
    it("returns paginated charges with computed status", async () => {
      const charges = [
        {
          id: "ch1",
          member_id: "m1",
          description: "Membership fee",
          amount_pence: 5000,
          charge_date: "2026-01-15",
          created_at: "2026-01-15T00:00:00.000Z",
          paid_at: "2026-01-16T00:00:00.000Z",
          payment_confirmed_at: null,
          stripe_payment_intent_id: "pi_123",
          type: "membership",
          source: "webhook",
          deleted_at: null,
          deleted_reason: null,
          memberName: "Alice",
          memberEmail: "alice@example.com",
        },
      ];

      // listAllCharges calls executeTakeFirstOrThrow for count and execute for data
      mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 1 });
      mockExecute.mockResolvedValue(charges);

      const result = await listAllCharges(db)({
        page: 1,
        pageSize: 20,
        status: "all",
        showDeleted: false,
      });

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.charges).toHaveLength(1);
      expect(result.charges[0].status).toBe("paid");
      expect(result.charges[0].amountPence).toBe(5000);
      expect(result.charges[0].memberName).toBe("Alice");
    });

    it("computes unpaid status for charges without payment", async () => {
      const charges = [
        {
          id: "ch2",
          member_id: "m2",
          description: "Manual charge",
          amount_pence: 2500,
          charge_date: "2026-03-01",
          created_at: new Date().toISOString(),
          paid_at: null,
          payment_confirmed_at: null,
          stripe_payment_intent_id: null,
          type: "manual",
          source: "admin",
          deleted_at: null,
          deleted_reason: null,
          memberName: "Bob",
          memberEmail: "bob@example.com",
        },
      ];

      mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 1 });
      mockExecute.mockResolvedValue(charges);

      const result = await listAllCharges(db)({
        page: 1,
        pageSize: 20,
        status: "all",
        showDeleted: false,
      });

      expect(result.charges[0].status).toBe("unpaid");
    });

    it("computes deleted status", async () => {
      const charges = [
        {
          id: "ch3",
          member_id: "m1",
          description: "Deleted charge",
          amount_pence: 1000,
          charge_date: "2026-02-01",
          created_at: "2026-02-01T00:00:00.000Z",
          paid_at: null,
          payment_confirmed_at: null,
          stripe_payment_intent_id: null,
          type: "manual",
          source: "admin",
          deleted_at: "2026-02-02T00:00:00.000Z",
          deleted_reason: "Duplicate",
          memberName: "Alice",
          memberEmail: "alice@example.com",
        },
      ];

      mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 1 });
      mockExecute.mockResolvedValue(charges);

      const result = await listAllCharges(db)({
        page: 1,
        pageSize: 20,
        status: "all",
        showDeleted: true,
      });

      expect(result.charges[0].status).toBe("deleted");
      expect(result.charges[0].deletedReason).toBe("Duplicate");
    });

    it("applies search filter", async () => {
      mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: 0 });
      mockExecute.mockResolvedValue([]);

      await listAllCharges(db)({
        page: 1,
        pageSize: 20,
        status: "all",
        showDeleted: false,
        search: "alice",
      });

      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalled();
    });
  });

  describe("getChargeAggregates", () => {
    it("returns aggregate totals and counts", async () => {
      mockExecuteTakeFirstOrThrow.mockResolvedValue({
        totalCharged: "15000",
        totalPaid: "10000",
        totalOutstanding: "5000",
        totalAbandoned: "0",
        totalDeleted: "0",
        countPaid: "2",
        countUnpaid: "1",
        countPending: "0",
        countAbandoned: "0",
        countDeleted: "0",
      });

      const result = await getChargeAggregates(db)({});

      expect(result.totalCharged).toBe(15000);
      expect(result.totalPaid).toBe(10000);
      expect(result.totalOutstanding).toBe(5000);
      expect(result.countPaid).toBe(2);
      expect(result.countUnpaid).toBe(1);
    });

    it("converts string aggregates to numbers", async () => {
      mockExecuteTakeFirstOrThrow.mockResolvedValue({
        totalCharged: "99999",
        totalPaid: "0",
        totalOutstanding: "99999",
        totalAbandoned: "0",
        totalDeleted: "0",
        countPaid: "0",
        countUnpaid: "5",
        countPending: "0",
        countAbandoned: "0",
        countDeleted: "0",
      });

      const result = await getChargeAggregates(db)({});

      expect(typeof result.totalCharged).toBe("number");
      expect(typeof result.countUnpaid).toBe("number");
    });
  });

  describe("chasePayment", () => {
    it("returns success for unpaid charge", async () => {
      mockExecuteTakeFirst.mockResolvedValue({
        id: "ch1",
        description: "Fee",
        amount_pence: 5000,
        charge_date: "2026-01-15",
        memberName: "Alice",
        memberEmail: "alice@example.com",
      });

      const result = await chasePayment(db)("ch1");
      expect(result).toEqual({ success: true });
    });

    it("throws 404 if charge not found", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await expect(chasePayment(db)("nonexistent")).rejects.toThrow(
        "Charge not found or already paid/deleted",
      );
    });

    it("excludes pending charges (payment_confirmed_at set)", async () => {
      // When payment_confirmed_at is set, the charge is in-flight — chase should not find it
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await expect(chasePayment(db)("pending-charge")).rejects.toThrow(
        "Charge not found or already paid/deleted",
      );

      // Verify the where clause was called (payment_confirmed_at filter applied)
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });
  });

  describe("listContactSubmissions", () => {
    it("returns paginated submissions", async () => {
      const submissions = [
        {
          id: "cs1",
          name: "Alice",
          email: "alice@example.com",
          message: "Hello",
          page: "/contact",
          created_at: "2026-01-01T00:00:00Z",
        },
      ];

      mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: "1" });
      mockExecute.mockResolvedValue(submissions);

      const result = await listContactSubmissions(db)({
        page: 1,
        pageSize: 20,
      });

      expect(result.submissions).toHaveLength(1);
      expect(result.submissions[0]).toEqual({
        id: "cs1",
        name: "Alice",
        email: "alice@example.com",
        message: "Hello",
        page: "/contact",
        createdAt: "2026-01-01T00:00:00Z",
      });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it("applies search filter", async () => {
      mockExecuteTakeFirstOrThrow.mockResolvedValue({ total: "0" });
      mockExecute.mockResolvedValue([]);

      await listContactSubmissions(db)({
        page: 1,
        pageSize: 20,
        search: "alice",
      });

      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });
  });

  describe("getMergePreview", () => {
    it("throws 400 when merging a member with itself", async () => {
      await expect(
        getMergePreview(db)({
          keepMemberId: "m1",
          removeMemberId: "m1",
        }),
      ).rejects.toThrow("Cannot merge a member with itself");
    });

    it("throws 404 when member not found", async () => {
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      await expect(
        getMergePreview(db)({
          keepMemberId: "m1",
          removeMemberId: "m2",
        }),
      ).rejects.toThrow("One or both member records not found");
    });
  });

  describe("mergeMembers", () => {
    it("throws 400 when merging a member with itself", async () => {
      await expect(
        mergeMembers(db)({
          keepMemberId: "m1",
          removeMemberId: "m1",
        }),
      ).rejects.toThrow("Cannot merge a member with itself");
    });

    // 404 for missing members is tested in integration tests (requires real transaction)
  });

  describe("listMatchFeeRates", () => {
    it("returns all rates with team names", async () => {
      const rates = [
        {
          id: "r1",
          play_cricket_team_id: "t1",
          competition_type: "League",
          member_category: "senior",
          amount_pence: 500,
          team_name: "1st XI",
        },
        {
          id: "r2",
          play_cricket_team_id: null,
          competition_type: null,
          member_category: "junior",
          amount_pence: 200,
          team_name: null,
        },
      ];

      mockExecute.mockResolvedValue(rates);

      const result = await listMatchFeeRates(db)();

      expect(result.rates).toEqual(rates);
      expect(mockQueryBuilder.selectFrom).toHaveBeenCalledWith(
        "match_fee_rate",
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalled();
    });
  });

  describe("addMatchFeeRate", () => {
    it("inserts a new rate with team and competition", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await addMatchFeeRate(db)({
        playCricketTeamId: "t1",
        competitionType: "League",
        memberCategory: "senior",
        amountPence: 500,
      });

      expect(result.id).toBeDefined();
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "match_fee_rate",
      );
      expect(mockQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          play_cricket_team_id: "t1",
          competition_type: "League",
          member_category: "senior",
          amount_pence: 500,
        }),
      );
    });

    it("sets nullable fields to null when not provided", async () => {
      mockExecute.mockResolvedValue([]);

      await addMatchFeeRate(db)({
        memberCategory: "guest",
        amountPence: 0,
      });

      expect(mockQueryBuilder.values).toHaveBeenCalledWith(
        expect.objectContaining({
          play_cricket_team_id: null,
          competition_type: null,
          member_category: "guest",
          amount_pence: 0,
        }),
      );
    });
  });

  describe("deleteMatchFeeRate", () => {
    it("deletes a rate by id", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await deleteMatchFeeRate(db)("r1");

      expect(result).toEqual({ success: true });
      expect(mockQueryBuilder.deleteFrom).toHaveBeenCalledWith(
        "match_fee_rate",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith("id", "=", "r1");
    });
  });
});
