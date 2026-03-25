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
      leftJoin: vi.fn().mockReturnThis(),
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
  exportExpensesCsv,
  getExpenseHistory,
  getIncomeByMonth,
  getMembershipSummary,
  getOutstandingPayments,
} from "./service.ts";

const db = mockQueryBuilder as unknown as Kysely<DB>;

describe("getExpenseHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
  });

  it("returns paginated expenses with total count", async () => {
    const items = [
      {
        id: "exp-1",
        expense_type: "umpire_fee",
        description: "Umpire",
        amount_pence: 5000,
        receipt_image_url: null,
        created_at: "2026-06-15T10:00:00Z",
        status: "approved",
        submitted_at: "2026-06-15T10:00:00Z",
        approved_at: "2026-06-16T10:00:00Z",
        approved_by_name: "Admin User",
        rejected_reason: null,
        reimbursed_at: null,
        reimbursed_by_name: null,
        match_date: "2026-06-15",
        opposition: "Benwell CC",
        team_name: "1st XI",
        submitted_by_name: "Test User",
      },
    ];
    mockExecute.mockResolvedValue(items);
    mockExecuteTakeFirst.mockResolvedValue({ total: 1 });

    const result = await getExpenseHistory(db)({ page: 1, pageSize: 20 });

    expect(result.items).toEqual(items);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(mockQueryBuilder.selectFrom).toHaveBeenCalledWith(
      "matchday_expense",
    );
    expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
      "matchday",
      "matchday.id",
      "matchday_expense.matchday_id",
    );
  });

  it("applies status filter", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

    await getExpenseHistory(db)({
      page: 1,
      pageSize: 20,
      status: "approved,reimbursed",
    });

    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      "matchday_expense.status",
      "in",
      ["approved", "reimbursed"],
    );
  });

  it("applies date range filters", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

    await getExpenseHistory(db)({
      page: 1,
      pageSize: 20,
      dateFrom: "2026-04-01",
      dateTo: "2027-03-31",
    });

    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      "matchday.match_date",
      ">=",
      "2026-04-01",
    );
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      "matchday.match_date",
      "<=",
      "2027-03-31",
    );
  });

  it("applies expense type filter", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

    await getExpenseHistory(db)({
      page: 1,
      pageSize: 20,
      expenseType: "umpire_fee",
    });

    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      "matchday_expense.expense_type",
      "=",
      "umpire_fee",
    );
  });

  it("applies team filter", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

    await getExpenseHistory(db)({
      page: 1,
      pageSize: 20,
      teamId: "team-123",
    });

    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      "matchday.play_cricket_team_id",
      "=",
      "team-123",
    );
  });

  it("applies search filter with ilike on description and opposition", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirst.mockResolvedValue({ total: 0 });

    await getExpenseHistory(db)({
      page: 1,
      pageSize: 20,
      search: "umpire",
    });

    // The search uses eb.or() callback — verify .where was called with a function
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(expect.any(Function));
  });

  it("paginates correctly", async () => {
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirst.mockResolvedValue({ total: 50 });

    const result = await getExpenseHistory(db)({ page: 3, pageSize: 10 });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
    expect(result.total).toBe(50);
    expect(mockQueryBuilder.offset).toHaveBeenCalledWith(20);
    expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
  });
});

describe("exportExpensesCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockQueryBuilder)) {
      const val = (mockQueryBuilder as Record<string, unknown>)[key];
      if (typeof val === "function" && "mockReturnValue" in (val as object)) {
        (val as ReturnType<typeof vi.fn>).mockReturnValue(mockQueryBuilder);
      }
    }
  });

  it("returns CSV with headers and data rows", async () => {
    mockExecute.mockResolvedValue([
      {
        match_date: "2026-06-15",
        opposition: "Benwell CC",
        team_name: "1st XI",
        expense_type: "umpire_fee",
        description: "Umpire payment",
        amount_pence: 5000,
        status: "reimbursed",
        submitted_by: "Test User",
        submitted_at: "2026-06-15T10:00:00Z",
        approved_by: "Admin",
        approved_at: "2026-06-16T10:00:00Z",
        reimbursed_by: "Treasurer",
        reimbursed_at: "2026-06-17T10:00:00Z",
        rejected_reason: null,
      },
    ]);

    const csv = await exportExpensesCsv(db)({});
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "Match Date,Opposition,Team,Type,Description,Amount,Status,Submitted By,Submitted At,Approved By,Approved At,Reimbursed By,Reimbursed At,Rejected Reason",
    );
    expect(lines[1]).toContain("2026-06-15");
    expect(lines[1]).toContain("Benwell CC");
    expect(lines[1]).toContain("50.00");
    expect(lines[1]).toContain("reimbursed");
  });

  it("escapes CSV fields containing commas", async () => {
    mockExecute.mockResolvedValue([
      {
        match_date: "2026-06-15",
        opposition: "Benwell, Hill CC",
        team_name: "1st XI",
        expense_type: "teas",
        description: "Food, drinks",
        amount_pence: 3000,
        status: "approved",
        submitted_by: "Test User",
        submitted_at: "2026-06-15T10:00:00Z",
        approved_by: null,
        approved_at: null,
        reimbursed_by: null,
        reimbursed_at: null,
        rejected_reason: null,
      },
    ]);

    const csv = await exportExpensesCsv(db)({});
    const lines = csv.split("\n");

    expect(lines[1]).toContain('"Benwell, Hill CC"');
    expect(lines[1]).toContain('"Food, drinks"');
  });
});

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
