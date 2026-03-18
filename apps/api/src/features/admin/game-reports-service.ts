import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { ListGameReports } from "./schemas.js";

export function listGameReports(db: Kysely<DB>) {
  return async (params: ListGameReports) => {
    const { teamId, limit, offset } = params;

    let query = db
      .selectFrom("matchday")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .select([
        "matchday.id",
        "matchday.match_date",
        "matchday.opposition",
        "matchday.status",
        "matchday.play_cricket_team_id",
        "matchday.competition_type",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("matchday.match_date", "desc");

    if (teamId) {
      query = query.where("matchday.play_cricket_team_id", "=", teamId);
    }

    let countQuery = db
      .selectFrom("matchday")
      .select(sql<string>`count(*)`.as("count"));

    if (teamId) {
      countQuery = countQuery.where("play_cricket_team_id", "=", teamId);
    }

    const [matchdays, totalRow] = await Promise.all([
      query.limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    return {
      matchdays,
      total: Number(totalRow?.count ?? 0),
    };
  };
}

export function getMatchdayReport(db: Kysely<DB>) {
  return async (matchdayId: string) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .selectAll()
      .executeTakeFirst();

    if (!matchday) {
      throw Object.assign(new Error("Matchday not found"), {
        statusCode: 404,
      });
    }

    // Players with charge info
    const players = await db
      .selectFrom("matchday_player")
      .leftJoin("member", "member.id", "matchday_player.member_id")
      .leftJoin("charge", "charge.id", "matchday_player.charge_id")
      .where("matchday_player.matchday_id", "=", matchdayId)
      .select([
        "matchday_player.id",
        "matchday_player.player_name",
        "matchday_player.status",
        "matchday_player.member_id",
        "member.member_category",
        "charge.amount_pence as charge_amount_pence",
        "charge.paid_at as charge_paid_at",
        "charge.payment_method as charge_payment_method",
        "charge.deleted_at as charge_deleted_at",
      ])
      .orderBy("matchday_player.created_at", "asc")
      .execute();

    // Expenses
    const expenses = await db
      .selectFrom("matchday_expense")
      .where("matchday_id", "=", matchdayId)
      .selectAll()
      .orderBy("created_at", "asc")
      .execute();

    // Team info
    const team = await db
      .selectFrom("play_cricket_team")
      .where("id", "=", matchday.play_cricket_team_id)
      .select(["id", "name"])
      .executeTakeFirst();

    // Game sponsorship (if we have a Play-Cricket match ID)
    let sponsorship = null;
    if (matchday.play_cricket_match_id) {
      sponsorship =
        (await db
          .selectFrom("game_sponsorship")
          .where("game_id", "=", matchday.play_cricket_match_id)
          .where("approved", "=", true)
          .where("paid_at", "is not", null)
          .selectAll()
          .executeTakeFirst()) ?? null;
    }

    // Calculate financial summary
    const activeCharges = players.filter(
      (p) => p.charge_amount_pence != null && p.charge_deleted_at == null,
    );
    const totalIncoming = activeCharges.reduce(
      (sum, p) => sum + (p.charge_amount_pence ?? 0),
      0,
    );
    const totalPaid = activeCharges
      .filter((p) => p.charge_paid_at != null)
      .reduce((sum, p) => sum + (p.charge_amount_pence ?? 0), 0);
    const totalOutstanding = totalIncoming - totalPaid;
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount_pence, 0);
    const sponsorshipIncome = sponsorship?.amount_pence ?? 0;
    const profitLoss = totalIncoming + sponsorshipIncome - totalExpenses;

    return {
      matchday,
      team: team ?? null,
      players,
      expenses,
      sponsorship,
      summary: {
        totalIncoming,
        totalPaid,
        totalOutstanding,
        totalExpenses,
        sponsorshipIncome,
        profitLoss,
      },
    };
  };
}
