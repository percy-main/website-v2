import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
import { sql } from "kysely";

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
        sql<string>`strftime('%Y-%m', paid_at)`.as("month"),
        "type",
        sql<number>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy([sql`strftime('%Y-%m', paid_at)`, "type"])
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
        sql<string>`strftime('%Y-%m', paid_at)`.as("month"),
        sql<number>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy(sql`strftime('%Y-%m', paid_at)`)
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
        sql<string>`strftime('%Y-%m', paid_at)`.as("month"),
        sql<number>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy(sql`strftime('%Y-%m', paid_at)`)
      .execute();

    return {
      charges,
      gameSponsorIncome,
      playerSponsorIncome,
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
        sql<number>`COUNT(*)`.as("total"),
        sql<number>`SUM(CASE WHEN paid_until > ${now} THEN 1 ELSE 0 END)`.as(
          "active",
        ),
        sql<number>`SUM(CASE WHEN paid_until <= ${now} OR paid_until IS NULL THEN 1 ELSE 0 END)`.as(
          "lapsed",
        ),
      ])
      .groupBy("type")
      .execute();

    return { memberships };
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
          sql<number>`COUNT(*)`.as("total"),
          sql<number>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = true THEN 1 ELSE 0 END)`.as(
            "approved_paid",
          ),
          sql<number>`SUM(CASE WHEN paid_at IS NULL THEN 1 ELSE 0 END)`.as(
            "pending_payment",
          ),
          sql<number>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = false THEN 1 ELSE 0 END)`.as(
            "pending_approval",
          ),
          sql<number>`COALESCE(SUM(amount_pence), 0)`.as("total_amount_pence"),
        ])
        .executeTakeFirst(),
      playerQuery
        .select([
          sql<number>`COUNT(*)`.as("total"),
          sql<number>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = true THEN 1 ELSE 0 END)`.as(
            "approved_paid",
          ),
          sql<number>`SUM(CASE WHEN paid_at IS NULL THEN 1 ELSE 0 END)`.as(
            "pending_payment",
          ),
          sql<number>`SUM(CASE WHEN paid_at IS NOT NULL AND approved = false THEN 1 ELSE 0 END)`.as(
            "pending_approval",
          ),
          sql<number>`COALESCE(SUM(amount_pence), 0)`.as("total_amount_pence"),
        ])
        .executeTakeFirst(),
    ]);

    return { gameSponsorship: gameStats, playerSponsorship: playerStats };
  };
}

export function getMatchdayExpensesSummary(db: Kysely<DB>) {
  return async (dateFrom?: string, dateTo?: string) => {
    let query = db.selectFrom("matchday_expense");

    if (dateFrom) {
      query = query.where("created_at", ">=", dateFrom);
    }
    if (dateTo) {
      query = query.where("created_at", "<=", dateTo);
    }

    const breakdown = await query
      .select([
        "expense_type",
        sql<number>`COUNT(*)`.as("count"),
        sql<number>`SUM(amount_pence)`.as("total_pence"),
      ])
      .groupBy("expense_type")
      .execute();

    const grandTotal = breakdown.reduce(
      (sum, row) => sum + Number(row.total_pence ?? 0),
      0,
    );

    return { breakdown, grandTotal };
  };
}

export function getExpensesWithReceipts(db: Kysely<DB>) {
  return async (dateFrom?: string, dateTo?: string) => {
    let query = db
      .selectFrom("matchday_expense")
      .where("receipt_image_url", "is not", null);

    if (dateFrom) {
      query = query.where("created_at", ">=", dateFrom);
    }
    if (dateTo) {
      query = query.where("created_at", "<=", dateTo);
    }

    const expenses = await query
      .selectAll()
      .orderBy("created_at", "desc")
      .execute();

    return { expenses };
  };
}
