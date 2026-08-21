import type { DB } from "@percy-main/db";
import { hasClubWideAccess } from "@percy-main/shared/auth/permissions";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { getAssignedTeamIds } from "../../lib/team-access.ts";
import type { ListGameReports } from "./schemas.ts";

const ABANDONED_THRESHOLD_HOURS = 1;

function getAbandonedCutoff(): string {
  return new Date(
    Date.now() - ABANDONED_THRESHOLD_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

export type ChargeStatus =
  "paid" | "pending" | "unpaid" | "abandoned" | "deleted" | "relieved";

function getChargeStatus(
  paidAt: string | null,
  paymentConfirmedAt: string | null,
  deletedAt: string | null,
  stripePaymentIntentId: string | null,
  abandonedCutoff: string,
  createdAt: string,
  relievedAt: string | null,
): ChargeStatus {
  if (deletedAt) return "deleted";
  // Paid takes precedence over relieved: a paid-then-relieved charge means
  // the member paid before the grant landed, and the cash is in the bank.
  if (paidAt) return "paid";
  if (relievedAt) return "relieved";
  if (paymentConfirmedAt) return "pending";
  if (stripePaymentIntentId && createdAt < abandonedCutoff) return "abandoned";
  return "unpaid";
}

export function listGameReports(db: Kysely<DB>) {
  return async (userId: string, role: string, params: ListGameReports) => {
    const { teamId, limit, offset } = params;

    // Team-scoped officials only see reports for their assigned teams. No
    // assignments means nothing to show - short-circuit rather than emit an
    // empty IN list.
    let assignedTeamIds: string[] | null = null;
    if (!hasClubWideAccess(role, "matchday", "view")) {
      assignedTeamIds = await getAssignedTeamIds(db, userId);
      if (assignedTeamIds.length === 0) return { matchdays: [], total: 0 };
    }

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

    if (assignedTeamIds) {
      query = query.where(
        "matchday.play_cricket_team_id",
        "in",
        assignedTeamIds,
      );
    }

    if (teamId) {
      query = query.where("matchday.play_cricket_team_id", "=", teamId);
    }

    let countQuery = db
      .selectFrom("matchday")
      .select(sql<string>`count(*)`.as("count"));

    if (assignedTeamIds) {
      countQuery = countQuery.where(
        "play_cricket_team_id",
        "in",
        assignedTeamIds,
      );
    }

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
  return async (userId: string, role: string, matchdayId: string) => {
    // Same 404-on-out-of-scope rule as matchday's getMatch: a scoped official
    // can't tell another team's report from one that doesn't exist. The report
    // carries per-player charge amounts and expense totals, so this is a
    // financial boundary, not just a tidiness one.
    if (!hasClubWideAccess(role, "matchday", "view")) {
      const access = await db
        .selectFrom("matchday")
        .innerJoin(
          "team_official",
          "team_official.play_cricket_team_id",
          "matchday.play_cricket_team_id",
        )
        .where("matchday.id", "=", matchdayId)
        .where("team_official.user_id", "=", userId)
        .select("matchday.id")
        .executeTakeFirst();

      if (!access) {
        throw Object.assign(new Error("Matchday not found"), {
          statusCode: 404,
        });
      }
    }

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

    // Run independent queries in parallel
    const [players, expenses, team] = await Promise.all([
      // Players with charge info
      db
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
          "charge.payment_confirmed_at as charge_payment_confirmed_at",
          "charge.stripe_payment_intent_id as charge_stripe_payment_intent_id",
          "charge.created_at as charge_created_at",
          "charge.relieved_at as charge_relieved_at",
        ])
        .orderBy("matchday_player.created_at", "asc")
        .execute(),
      // Expenses
      db
        .selectFrom("matchday_expense")
        .where("matchday_id", "=", matchdayId)
        .selectAll()
        .orderBy("created_at", "asc")
        .execute(),
      // Team info
      db
        .selectFrom("play_cricket_team")
        .where("id", "=", matchday.play_cricket_team_id)
        .select(["id", "name"])
        .executeTakeFirst(),
    ]);

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

    // Derive charge status for each player
    const abandonedCutoff = getAbandonedCutoff();
    const playersWithStatus = players.map((p) => ({
      ...p,
      charge_status:
        p.charge_amount_pence != null
          ? getChargeStatus(
              p.charge_paid_at,
              p.charge_payment_confirmed_at,
              p.charge_deleted_at,
              p.charge_stripe_payment_intent_id,
              abandonedCutoff,
              p.charge_created_at ?? "",
              p.charge_relieved_at,
            )
          : null,
    }));

    // Calculate financial summary using derived status. Relieved charges are
    // waived donations — the club isn't collecting them, so they shouldn't
    // contribute to incoming or outstanding totals.
    const activeCharges = playersWithStatus.filter(
      (p) =>
        p.charge_amount_pence != null &&
        p.charge_status !== "deleted" &&
        p.charge_status !== "abandoned" &&
        p.charge_status !== "relieved",
    );
    const totalIncoming = activeCharges.reduce(
      (sum, p) => sum + (p.charge_amount_pence ?? 0),
      0,
    );
    const totalPaid = activeCharges
      .filter((p) => p.charge_status === "paid")
      .reduce((sum, p) => sum + (p.charge_amount_pence ?? 0), 0);
    const totalPending = activeCharges
      .filter((p) => p.charge_status === "pending")
      .reduce((sum, p) => sum + (p.charge_amount_pence ?? 0), 0);
    const totalOutstanding = totalIncoming - totalPaid - totalPending;
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount_pence, 0);
    const sponsorshipIncome = sponsorship?.amount_pence ?? 0;
    const profitLoss = totalIncoming + sponsorshipIncome - totalExpenses;

    return {
      matchday,
      team: team ?? null,
      players: playersWithStatus,
      expenses,
      sponsorship,
      summary: {
        totalIncoming,
        totalPaid,
        totalPending,
        totalOutstanding,
        totalExpenses,
        sponsorshipIncome,
        profitLoss,
      },
    };
  };
}
