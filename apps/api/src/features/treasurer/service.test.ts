import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteTakeFirst, mockExecute, mockQueryBuilder } = vi.hoisted(
  () => {
    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();

    const mockQueryBuilder = {
      selectFrom: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
      fn: {
        countAll: vi.fn().mockReturnValue({
          as: vi.fn().mockReturnValue("count_expr"),
        }),
      },
    };

    return { mockExecuteTakeFirst, mockExecute, mockQueryBuilder };
  },
);

vi.mock("kysely", () => ({
  sql: new Proxy(() => "sql_expr", {
    get() {
      return () => ({
        as: () => "sql_expr",
      });
    },
    apply() {
      return {
        as: () => "sql_expr",
      };
    },
  }),
}));

import {
  getIncomeByMonth,
  getMembershipSummary,
  getOutstandingPayments,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("treasurer service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
  });

  describe("getIncomeByMonth", () => {
    it("returns monthly breakdown", async () => {
      const chargeData = [
        { month: "2026-01", charge_type: "membership", total_pence: 10000 },
        { month: "2026-02", charge_type: "membership", total_pence: 15000 },
      ];
      mockExecute.mockResolvedValue(chargeData);

      const result = await getIncomeByMonth(db)();

      expect(result.charges).toEqual(chargeData);
      expect(mockQueryBuilder.selectFrom).toHaveBeenCalledWith("charge");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "paid_at",
        "is not",
        null,
      );
    });

    it("applies date range filters", async () => {
      mockExecute.mockResolvedValue([]);

      await getIncomeByMonth(db)("2026-01-01", "2026-03-31");

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "paid_at",
        ">=",
        "2026-01-01",
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "paid_at",
        "<=",
        "2026-03-31",
      );
    });
  });

  describe("getMembershipSummary", () => {
    it("counts active vs lapsed memberships", async () => {
      const summaryData = [
        { type: "adult", total: 50, active: 40, lapsed: 10 },
        { type: "junior", total: 20, active: 18, lapsed: 2 },
      ];
      mockExecute.mockResolvedValue(summaryData);

      const result = await getMembershipSummary(db)();

      expect(result.memberships).toEqual(summaryData);
      expect(mockQueryBuilder.selectFrom).toHaveBeenCalledWith("membership");
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith("type");
    });
  });

  describe("getOutstandingPayments", () => {
    it("returns only unpaid charges", async () => {
      const unpaid = [
        {
          id: "c1",
          charge_type: "membership",
          amount_pence: 5000,
          member_name: "Alice",
          member_email: "alice@example.com",
        },
      ];

      mockExecute.mockResolvedValue(unpaid);
      mockExecuteTakeFirst.mockResolvedValue({ total: 1 });

      const result = await getOutstandingPayments(db)(1, 20);

      expect(result.items).toEqual(unpaid);
      expect(result.total).toBe(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "charge.paid_at",
        "is",
        null,
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "charge.payment_confirmed_at",
        "is",
        null,
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "charge.deleted_at",
        "is",
        null,
      );
    });

    it("paginates results", async () => {
      mockExecute.mockResolvedValue([]);
      mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

      const result = await getOutstandingPayments(db)(2, 10);

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
    });
  });
});
