import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { ExpenseHistoryQuery } from "./schemas.ts";

export function getExpenseHistory(db: Kysely<DB>) {
  return async (params: ExpenseHistoryQuery) => {
    const {
      dateFrom,
      dateTo,
      status,
      expenseType,
      search,
      teamId,
      page,
      pageSize,
    } = params;
    const offset = (page - 1) * pageSize;

    let baseQuery = db
      .selectFrom("matchday_expense")
      .innerJoin("matchday", "matchday.id", "matchday_expense.matchday_id")
      .innerJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .innerJoin(
        "user as submitter",
        "submitter.id",
        "matchday_expense.created_by",
      )
      .leftJoin(
        "user as approver",
        "approver.id",
        "matchday_expense.approved_by",
      )
      .leftJoin(
        "user as reimburser",
        "reimburser.id",
        "matchday_expense.reimbursed_by",
      );

    if (dateFrom) {
      baseQuery = baseQuery.where("matchday.match_date", ">=", dateFrom);
    }
    if (dateTo) {
      baseQuery = baseQuery.where("matchday.match_date", "<=", dateTo);
    }
    if (status) {
      const statuses = status.split(",");
      baseQuery = baseQuery.where("matchday_expense.status", "in", statuses);
    }
    if (expenseType) {
      baseQuery = baseQuery.where(
        "matchday_expense.expense_type",
        "=",
        expenseType,
      );
    }
    if (teamId) {
      baseQuery = baseQuery.where("matchday.play_cricket_team_id", "=", teamId);
    }
    if (search) {
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb("matchday_expense.description", "ilike", `%${search}%`),
          eb("matchday.opposition", "ilike", `%${search}%`),
        ]),
      );
    }

    const [items, countResult] = await Promise.all([
      baseQuery
        .select([
          "matchday_expense.id",
          "matchday_expense.expense_type",
          "matchday_expense.description",
          "matchday_expense.amount_pence",
          "matchday_expense.receipt_image_url",
          "matchday_expense.created_at",
          "matchday_expense.status",
          "matchday_expense.submitted_at",
          "matchday_expense.approved_at",
          "approver.name as approved_by_name",
          "matchday_expense.rejected_reason",
          "matchday_expense.reimbursed_at",
          "reimburser.name as reimbursed_by_name",
          "matchday.match_date",
          "matchday.opposition",
          "play_cricket_team.name as team_name",
          "submitter.name as submitted_by_name",
        ])
        .orderBy("matchday.match_date", "desc")
        .orderBy("matchday_expense.created_at", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
      baseQuery.select(db.fn.countAll().as("total")).executeTakeFirst(),
    ]);

    return {
      items,
      total: Number(countResult?.total ?? 0),
      page,
      pageSize,
    };
  };
}

export function exportExpensesCsv(db: Kysely<DB>) {
  return async (params: Omit<ExpenseHistoryQuery, "page" | "pageSize">) => {
    const { dateFrom, dateTo, status, expenseType, search, teamId } = params;

    let query = db
      .selectFrom("matchday_expense")
      .innerJoin("matchday", "matchday.id", "matchday_expense.matchday_id")
      .innerJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .innerJoin(
        "user as submitter",
        "submitter.id",
        "matchday_expense.created_by",
      )
      .leftJoin(
        "user as approver",
        "approver.id",
        "matchday_expense.approved_by",
      )
      .leftJoin(
        "user as reimburser",
        "reimburser.id",
        "matchday_expense.reimbursed_by",
      );

    if (dateFrom) {
      query = query.where("matchday.match_date", ">=", dateFrom);
    }
    if (dateTo) {
      query = query.where("matchday.match_date", "<=", dateTo);
    }
    if (status) {
      const statuses = status.split(",");
      query = query.where("matchday_expense.status", "in", statuses);
    }
    if (expenseType) {
      query = query.where("matchday_expense.expense_type", "=", expenseType);
    }
    if (teamId) {
      query = query.where("matchday.play_cricket_team_id", "=", teamId);
    }
    if (search) {
      query = query.where((eb) =>
        eb.or([
          eb("matchday_expense.description", "ilike", `%${search}%`),
          eb("matchday.opposition", "ilike", `%${search}%`),
        ]),
      );
    }

    const rows = await query
      .select([
        "matchday.match_date",
        "matchday.opposition",
        "play_cricket_team.name as team_name",
        "matchday_expense.expense_type",
        "matchday_expense.description",
        "matchday_expense.amount_pence",
        "matchday_expense.status",
        "submitter.name as submitted_by",
        "matchday_expense.submitted_at",
        "approver.name as approved_by",
        "matchday_expense.approved_at",
        "reimburser.name as reimbursed_by",
        "matchday_expense.reimbursed_at",
        "matchday_expense.rejected_reason",
      ])
      .orderBy("matchday.match_date", "desc")
      .execute();

    const headers = [
      "Match Date",
      "Opposition",
      "Team",
      "Type",
      "Description",
      "Amount",
      "Status",
      "Submitted By",
      "Submitted At",
      "Approved By",
      "Approved At",
      "Reimbursed By",
      "Reimbursed At",
      "Rejected Reason",
    ];

    const csvRows = rows.map((r) => [
      r.match_date,
      escapeCsvField(r.opposition),
      escapeCsvField(r.team_name),
      r.expense_type,
      escapeCsvField(r.description ?? ""),
      (r.amount_pence / 100).toFixed(2),
      r.status,
      escapeCsvField(r.submitted_by),
      r.submitted_at ?? "",
      escapeCsvField(r.approved_by ?? ""),
      r.approved_at ?? "",
      escapeCsvField(r.reimbursed_by ?? ""),
      r.reimbursed_at ?? "",
      escapeCsvField(r.rejected_reason ?? ""),
    ]);

    return [headers, ...csvRows].map((row) => row.join(",")).join("\n");
  };
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function getIncomeByMonth(db: Kysely<DB>) {
  return async (dateFrom?: string, dateTo?: string) => {
    let query = db
      .selectFrom("charge")
      .where("paid_at", "is not", null)
      .where("deleted_at", "is", null);

    if (dateFrom) {
      query = query.where("paid_at", ">=", dateFrom);
    }
    if (dateTo) {
      query = query.where("paid_at", "<=", dateTo);
    }

    const charges = await query
      .select([
        sql<string>`LEFT(paid_at, 7)`.as("month"),
        "type",
        sql<string>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy([sql`LEFT(paid_at, 7)`, "type"])
      .orderBy("month", "asc")
      .execute();

    // Also aggregate sponsorship income
    let gameSponsorQuery = db
      .selectFrom("game_sponsorship")
      .where("paid_at", "is not", null);

    if (dateFrom) {
      gameSponsorQuery = gameSponsorQuery.where("paid_at", ">=", dateFrom);
    }
    if (dateTo) {
      gameSponsorQuery = gameSponsorQuery.where("paid_at", "<=", dateTo);
    }

    const gameSponsorIncome = await gameSponsorQuery
      .select([
        sql<string>`LEFT(paid_at, 7)`.as("month"),
        sql<string>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy(sql`LEFT(paid_at, 7)`)
      .execute();

    let playerSponsorQuery = db
      .selectFrom("player_sponsorship")
      .where("paid_at", "is not", null);

    if (dateFrom) {
      playerSponsorQuery = playerSponsorQuery.where("paid_at", ">=", dateFrom);
    }
    if (dateTo) {
      playerSponsorQuery = playerSponsorQuery.where("paid_at", "<=", dateTo);
    }

    const playerSponsorIncome = await playerSponsorQuery
      .select([
        sql<string>`LEFT(paid_at, 7)`.as("month"),
        sql<string>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy(sql`LEFT(paid_at, 7)`)
      .execute();

    return {
      charges: charges.map((c) => ({
        ...c,
        total_pence: Number(c.total_pence),
      })),
      gameSponsorIncome: gameSponsorIncome.map((s) => ({
        ...s,
        total_pence: Number(s.total_pence),
      })),
      playerSponsorIncome: playerSponsorIncome.map((s) => ({
        ...s,
        total_pence: Number(s.total_pence),
      })),
    };
  };
}

export function getMembershipSummary(db: Kysely<DB>) {
  return async () => {
    const now = new Date().toISOString();

    const memberships = await db
      .selectFrom("membership")
      .select([
        "type",
        sql<string>`COUNT(*)`.as("total"),
        sql<string>`SUM(CASE WHEN paid_until > ${now} THEN 1 ELSE 0 END)`.as(
          "active",
        ),
        sql<string>`SUM(CASE WHEN paid_until <= ${now} OR paid_until IS NULL THEN 1 ELSE 0 END)`.as(
          "lapsed",
        ),
      ])
      .groupBy("type")
      .execute();

    return {
      memberships: memberships.map((m) => ({
        ...m,
        total: Number(m.total),
        active: Number(m.active),
        lapsed: Number(m.lapsed),
      })),
    };
  };
}

export function getOutstandingPayments(db: Kysely<DB>) {
  return async (page: number, pageSize: number) => {
    const offset = (page - 1) * pageSize;

    const [items, countResult] = await Promise.all([
      db
        .selectFrom("charge")
        .innerJoin("member", "member.id", "charge.member_id")
        .where("charge.paid_at", "is", null)
        .where("charge.payment_confirmed_at", "is", null)
        .where("charge.deleted_at", "is", null)
        .select([
          "charge.id",
          "charge.type",
          "charge.amount_pence",
          "charge.charge_date",
          "charge.description",
          "member.name as member_name",
          "member.email as member_email",
        ])
        .orderBy("charge.charge_date", "desc")
        .limit(pageSize)
        .offset(offset)
        .execute(),
      db
        .selectFrom("charge")
        .where("paid_at", "is", null)
        .where("payment_confirmed_at", "is", null)
        .where("deleted_at", "is", null)
        .select(db.fn.countAll().as("total"))
        .executeTakeFirst(),
    ]);

    return {
      items,
      total: Number(countResult?.total ?? 0),
      page,
      pageSize,
    };
  };
}

export function getSponsorshipSummary(db: Kysely<DB>) {
  return async (dateFrom?: string, dateTo?: string) => {
    let gameQuery = db.selectFrom("game_sponsorship");
    let playerQuery = db.selectFrom("player_sponsorship");

    if (dateFrom) {
      gameQuery = gameQuery.where("created_at", ">=", dateFrom);
      playerQuery = playerQuery.where("created_at", ">=", dateFrom);
    }
    if (dateTo) {
      gameQuery = gameQuery.where("created_at", "<=", dateTo);
      playerQuery = playerQuery.where("created_at", "<=", dateTo);
    }

    const [gameStats, playerStats] = await Promise.all([
      gameQuery
        .select([
          sql<string>`COUNT(*)`.as("total"),
          sql<string>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = true THEN 1 ELSE 0 END)`.as(
            "approved_paid",
          ),
          sql<string>`SUM(CASE WHEN paid_at IS NULL THEN 1 ELSE 0 END)`.as(
            "pending_payment",
          ),
          sql<string>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = false THEN 1 ELSE 0 END)`.as(
            "pending_approval",
          ),
          sql<string>`COALESCE(SUM(amount_pence), 0)`.as("total_amount_pence"),
        ])
        .executeTakeFirst(),
      playerQuery
        .select([
          sql<string>`COUNT(*)`.as("total"),
          sql<string>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = true THEN 1 ELSE 0 END)`.as(
            "approved_paid",
          ),
          sql<string>`SUM(CASE WHEN paid_at IS NULL THEN 1 ELSE 0 END)`.as(
            "pending_payment",
          ),
          sql<string>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = false THEN 1 ELSE 0 END)`.as(
            "pending_approval",
          ),
          sql<string>`COALESCE(SUM(amount_pence), 0)`.as("total_amount_pence"),
        ])
        .executeTakeFirst(),
    ]);

    const toNumbers = (stats: typeof gameStats) => ({
      total: Number(stats?.total ?? 0),
      approved_paid: Number(stats?.approved_paid ?? 0),
      pending_payment: Number(stats?.pending_payment ?? 0),
      pending_approval: Number(stats?.pending_approval ?? 0),
      total_amount_pence: Number(stats?.total_amount_pence ?? 0),
    });

    return {
      gameSponsorship: toNumbers(gameStats),
      playerSponsorship: toNumbers(playerStats),
    };
  };
}

export function getMatchdayExpensesSummary(db: Kysely<DB>) {
  return async (dateFrom?: string, dateTo?: string) => {
    let query = db
      .selectFrom("matchday_expense")
      .where("status", "!=", "draft");

    if (dateFrom) {
      query = query.where("created_at", ">=", dateFrom);
    }
    if (dateTo) {
      query = query.where("created_at", "<=", dateTo);
    }

    const rawBreakdown = await query
      .select([
        "expense_type",
        sql<string>`COUNT(*)`.as("count"),
        sql<string>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy("expense_type")
      .execute();

    const breakdown = rawBreakdown.map((row) => ({
      ...row,
      count: Number(row.count),
      total_pence: Number(row.total_pence),
    }));

    const grandTotal = breakdown.reduce((sum, row) => sum + row.total_pence, 0);

    return { breakdown, grandTotal };
  };
}

export function getExpensesWithReceipts(db: Kysely<DB>) {
  return async (dateFrom?: string, dateTo?: string) => {
    let query = db
      .selectFrom("matchday_expense")
      .innerJoin("matchday", "matchday.id", "matchday_expense.matchday_id")
      .innerJoin("user", "user.id", "matchday_expense.created_by")
      .where("matchday_expense.status", "not in", ["draft", "reimbursed"]);

    if (dateFrom) {
      query = query.where("matchday_expense.created_at", ">=", dateFrom);
    }
    if (dateTo) {
      query = query.where("matchday_expense.created_at", "<=", dateTo);
    }

    const expenses = await query
      .select([
        "matchday_expense.id",
        "matchday_expense.expense_type",
        "matchday_expense.description",
        "matchday_expense.amount_pence",
        "matchday_expense.receipt_image_url",
        "matchday_expense.created_at",
        "matchday_expense.status",
        "matchday_expense.submitted_at",
        "matchday_expense.approved_at",
        "matchday_expense.rejected_reason",
        "matchday_expense.reimbursed_at",
        "matchday.match_date",
        "matchday.opposition",
        "user.name as submitted_by_name",
      ])
      .orderBy("matchday_expense.created_at", "desc")
      .execute();

    return { expenses };
  };
}
