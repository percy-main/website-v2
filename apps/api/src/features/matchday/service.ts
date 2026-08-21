import type { DB } from "@percy-main/db";
import {
  hasClubWideAccess,
  parseRoles,
} from "@percy-main/shared/auth/permissions";
import {
  format as formatDate,
  isBefore,
  parse,
  startOfDay,
  subDays,
} from "date-fns";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { SendPush } from "../../lib/push-sender.ts";
import type { S3Uploader } from "../../lib/s3-upload.ts";
import {
  getAccessibleTeamIds,
  getAssignedTeamIds,
} from "../../lib/team-access.ts";
import { applyReliefIfAny } from "../financial-relief/apply-relief.ts";
import type { MatchdayChannel } from "../notification-preferences/schemas.ts";
import {
  DEFAULT_MATCHDAY_CHANNEL,
  getNotificationPreferencesByUserIds,
} from "../notification-preferences/service.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsForUsers,
} from "../push-subscriptions/service.ts";
import type {
  AddPlayer,
  CancelMatchday,
  CreateMatchday,
  FinishMatch,
  ListMatches,
  ListPendingExpenses,
  RecordExpense,
  RejectExpense,
  SearchMembers,
  SetRoles,
  SubmitExpense,
  UpdateExpense,
} from "./schemas.ts";

// ── Helpers ──

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

const EXPENSE_WINDOW_DAYS_AFTER = 5;

function isPastExpenseCutoff(matchDate: string, now = new Date()): boolean {
  const match = new Date(`${matchDate}T00:00:00Z`);
  if (Number.isNaN(match.getTime())) return false;
  const cutoff = new Date(match);
  cutoff.setUTCDate(cutoff.getUTCDate() + EXPENSE_WINDOW_DAYS_AFTER + 1);
  return now >= cutoff;
}

/**
 * Parse a base64 data URL, upload to S3, and return the URL.
 * Returns null if no image provided.
 */
async function uploadReceiptImage(
  receiptImage: string | undefined,
  expenseId: string,
  s3: S3Uploader,
): Promise<string | null> {
  if (!receiptImage) return null;

  const match = /^data:(image\/(?:jpeg|png|webp|heic));base64,(.+)$/.exec(
    receiptImage,
  );
  if (!match) throwHttpError(400, "Invalid receipt image format");

  const imageBytes = Buffer.from(match[2], "base64");
  return s3.uploadReceipt({
    imageBytes,
    contentType: match[1],
    expenseId,
  });
}

/**
 * Find the best matching fee rate. Priority:
 * 1. team + competition + category
 * 2. team + any competition + category
 * 3. any team + competition + category
 * 4. any team + any competition + category
 */
function findFeeRate(
  rates: Array<{
    play_cricket_team_id: string | null;
    competition_type: string | null;
    member_category: string;
    amount_pence: number;
  }>,
  teamId: string,
  competitionType: string | null,
  category: string,
) {
  return (
    rates.find(
      (r) =>
        r.play_cricket_team_id === teamId &&
        r.competition_type === competitionType &&
        r.member_category === category,
    ) ??
    rates.find(
      (r) =>
        r.play_cricket_team_id === teamId &&
        r.competition_type === null &&
        r.member_category === category,
    ) ??
    rates.find(
      (r) =>
        r.play_cricket_team_id === null &&
        r.competition_type === competitionType &&
        r.member_category === category,
    ) ??
    rates.find(
      (r) =>
        r.play_cricket_team_id === null &&
        r.competition_type === null &&
        r.member_category === category,
    )
  );
}

// ── Existing services ──

export function listMatches(db: Kysely<DB>) {
  return async (userId: string, role: string, params: ListMatches) => {
    const { teamId, limit, offset, statusFilter } = params;

    let query = db.selectFrom("matchday").selectAll("matchday");

    // Non-admin officials can only see matches for their assigned teams
    if (!hasClubWideAccess(role, "matchday", "view")) {
      query = query
        .innerJoin(
          "team_official",
          "team_official.play_cricket_team_id",
          "matchday.play_cricket_team_id",
        )
        .where("team_official.user_id", "=", userId);
    }

    if (teamId) {
      query = query.where("matchday.play_cricket_team_id", "=", teamId);
    }

    if (statusFilter !== "all") {
      query = query.where("matchday.status", "=", statusFilter);
    }

    const items = await query
      .orderBy("matchday.match_date", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    return { items };
  };
}

export function getMatch(db: Kysely<DB>) {
  return async (userId: string, role: string, matchId: string) => {
    // Verify access
    if (!hasClubWideAccess(role, "matchday", "view")) {
      const access = await db
        .selectFrom("matchday")
        .innerJoin(
          "team_official",
          "team_official.play_cricket_team_id",
          "matchday.play_cricket_team_id",
        )
        .where("matchday.id", "=", matchId)
        .where("team_official.user_id", "=", userId)
        .select("matchday.id")
        .executeTakeFirst();

      if (!access) {
        throwHttpError(404, "Match not found or access denied");
      }
    }

    const match = await db
      .selectFrom("matchday")
      .where("id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    if (!match) {
      throwHttpError(404, "Match not found");
    }

    const team = await db
      .selectFrom("play_cricket_team")
      .where("id", "=", match.play_cricket_team_id)
      .select(["id", "name"])
      .executeTakeFirst();

    const [players, expenses] = await Promise.all([
      db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchId)
        .leftJoin("member", "member.id", "matchday_player.member_id")
        .leftJoin("dependent", "dependent.id", "matchday_player.dependent_id")
        .leftJoin(
          "member as dependent_parent",
          "dependent_parent.id",
          "dependent.member_id",
        )
        .leftJoin("charge", "charge.id", "matchday_player.charge_id")
        .select([
          "matchday_player.id",
          "matchday_player.member_id",
          "matchday_player.dependent_id",
          "matchday_player.player_name",
          "matchday_player.status",
          "matchday_player.replaced_by_matchday_player_id",
          "matchday_player.charge_id",
          "matchday_player.created_at",
          "matchday_player.is_captain",
          "matchday_player.is_wicketkeeper",
          "member.member_category",
          "dependent_parent.name as parent_name",
          "charge.paid_at as chargePaidAt",
          "charge.relieved_at as chargeRelievedAt",
        ])
        .orderBy("matchday_player.created_at", "asc")
        .execute(),
      db
        .selectFrom("matchday_expense")
        .where("matchday_id", "=", matchId)
        .selectAll()
        .orderBy("created_at", "asc")
        .execute(),
    ]);

    // Derive a neutral status for the captain — never leak the
    // relief audit columns themselves over this endpoint.
    const projectedPlayers = players.map(
      ({ chargeRelievedAt, chargePaidAt, ...rest }) => ({
        ...rest,
        chargePaidAt,
        chargeStatus: !rest.charge_id
          ? null
          : chargePaidAt
            ? ("paid" as const)
            : chargeRelievedAt
              ? ("waived" as const)
              : ("unpaid" as const),
      }),
    );

    return {
      matchday: match,
      team: team ?? null,
      players: projectedPlayers,
      expenses,
    };
  };
}

/**
 * Reduced-shape team sheet visible to any signed-in member.
 *
 * Any signed-in member can read pending/confirmed/finished matchdays -
 * `pending` is the live squad-pick state since the pre-match confirm
 * step was removed, so the team sheet must be readable there. Only
 * cancelled matchdays 404 (cancel reason may carry PII and there's no
 * sensible squad to show). The response strips every sensitive
 * surface (no expenses, no charge IDs, no amounts, no audit timestamps).
 */
export function getMatchPublic(db: Kysely<DB>) {
  return async (matchId: string) => {
    const match = await db
      .selectFrom("matchday")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .where("matchday.id", "=", matchId)
      .select([
        "matchday.id",
        "matchday.match_date",
        "matchday.opposition",
        "matchday.competition_type",
        "matchday.status",
        "matchday.result_type",
        "matchday.is_home",
        "matchday.match_time",
        "play_cricket_team.name as team_name",
      ])
      .executeTakeFirst();
    if (!match) {
      throwHttpError(404, "Matchday not found");
    }
    // Cancelled matchdays: the cancel reason on the parent record is a
    // free-text field captured from officials and may carry PII. The
    // public projection doesn't expose the reason today, but skip the
    // squad reveal too - a cancelled fixture has no team sheet to show.
    // `pending` used to 404 here ("team not yet announced") but the
    // pre-match confirm step was removed; pending is the live state
    // captains pick squads into, so the team sheet must be readable.
    if (match.status === "cancelled") {
      throwHttpError(404, "Matchday cancelled");
    }

    const players = await db
      .selectFrom("matchday_player")
      .leftJoin("member", "member.id", "matchday_player.member_id")
      .where("matchday_player.matchday_id", "=", matchId)
      .select([
        "matchday_player.id as matchday_player_id",
        "matchday_player.member_id",
        "matchday_player.dependent_id",
        "matchday_player.player_name",
        "matchday_player.status",
        "matchday_player.is_captain",
        "matchday_player.is_wicketkeeper",
        "matchday_player.created_at",
        "member.name as member_name",
      ])
      .orderBy("matchday_player.created_at", "asc")
      .execute();

    const projected = players.map((p) => ({
      matchdayPlayerId: p.matchday_player_id,
      memberId: p.member_id,
      isCaptain: p.is_captain,
      isKeeper: p.is_wicketkeeper,
      // Guest = an ad-hoc player with no record at all. Juniors point
      // at a `dependent` row, so they're not guests even though their
      // `member_id` is null.
      isGuest: p.member_id === null && p.dependent_id === null,
      displayName: p.member_name ?? p.player_name ?? "Unknown",
      note: null as string | null,
      _status: p.status,
    }));

    const squad = projected
      .filter((p) => p._status === "playing" || p._status === "selected")
      .map(({ _status, ...rest }) => rest);
    const dropouts = projected
      .filter(
        (p) =>
          p._status === "dropped_out" ||
          p._status === "no_show" ||
          p._status === "withdrawn",
      )
      .map(({ _status, ...rest }) => rest);

    return {
      id: match.id,
      matchDate: match.match_date,
      // Start time and home/away come from the matchday's own columns,
      // which are only populated for custom (non-Play-Cricket)
      // fixtures. For PC-backed matchdays they stay null - deriving
      // them means joining the play_cricket_match record, which this
      // service doesn't load yet (Phase 2.1 cleanup if we need it).
      // Ground and score summary likewise. The schema is `.nullable()`
      // so callers render "—" or hide the field rather than treat
      // `false` as truth.
      startTime: match.match_time,
      teamName: match.team_name,
      opposition: match.opposition,
      ground: null as string | null,
      competition: match.competition_type,
      away: match.is_home === null ? null : !match.is_home,
      status: match.status as "pending" | "confirmed" | "finished",
      result: match.result_type,
      scoreSummary: null as string | null,
      squad,
      dropouts,
    };
  };
}

/**
 * Upcoming matchdays the signed-in user has been picked for.
 *
 * "Picked" = matchday_player row exists for this user's member, with
 * status "selected" or "playing" (matches getMatchPublic's squad
 * projection). Matchday itself must still be active - `pending` is the
 * normal state since the pre-match confirm step was removed; legacy
 * `confirmed` rows still count. `finished` / `cancelled` drop off.
 *
 * Returns all future selections (no near-term window): callers like
 * the home dashboard slice locally to a few days; other surfaces
 * (e.g. a "what am I picked for this season" view) want the full list.
 *
 * Privacy: callers only see their own selections - resolved through
 * the member.email = user.email link used elsewhere (e.g.
 * charges/service.ts). If a member row doesn't exist for the user's
 * email yet, returns an empty list.
 */
export function getMyUpcomingMatches(db: Kysely<DB>) {
  return async (email: string) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .select(["id"])
      .executeTakeFirst();
    if (!member) return [];

    // A parent sees (and can drop out) their juniors' selections on the
    // same card as their own, so pull the member's dependents and fold
    // their matchday_player rows into the same query.
    const dependents = await db
      .selectFrom("dependent")
      .where("member_id", "=", member.id)
      .select(["id", "name"])
      .execute();
    const dependentNameById = new Map(dependents.map((d) => [d.id, d.name]));
    const dependentIds = dependents.map((d) => d.id);

    const todayIso = formatDate(new Date(), "yyyy-MM-dd");

    const rows = await db
      .selectFrom("matchday_player")
      .innerJoin("matchday", "matchday.id", "matchday_player.matchday_id")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .where((eb) =>
        eb.or([
          eb("matchday_player.member_id", "=", member.id),
          ...(dependentIds.length > 0
            ? [eb("matchday_player.dependent_id", "in", dependentIds)]
            : []),
        ]),
      )
      .where("matchday_player.status", "in", ["selected", "playing"])
      .where("matchday.status", "in", ["pending", "confirmed"])
      .where("matchday.match_date", ">=", todayIso)
      .select([
        "matchday_player.id as matchdayPlayerId",
        "matchday.id as matchdayId",
        "matchday.match_date as matchDate",
        "matchday.opposition",
        "matchday.competition_type as competitionType",
        "play_cricket_team.name as teamName",
        "matchday_player.is_captain as isCaptain",
        "matchday_player.is_wicketkeeper as isWicketkeeper",
        "matchday_player.player_name as playerName",
        "matchday_player.dependent_id as dependentId",
      ])
      .orderBy("matchday.match_date", "asc")
      .execute();

    return rows.map(({ dependentId, ...row }) => ({
      ...row,
      forDependent: dependentId !== null,
      dependentName: dependentId
        ? (dependentNameById.get(dependentId) ?? null)
        : null,
    }));
  };
}

/**
 * Aggregate runs / wickets / catches for the signed-in user across
 * matches in the trailing `windowDays` window (default 28).
 *
 * Performance rows are keyed by Play-Cricket player_id (string), so we
 * resolve email → member.play_cricket_id. Members without a linked
 * Play-Cricket ID get zeros — they exist in the DB but no historical
 * stats can be attributed to them.
 *
 * matchesPlayed is the count of distinct match_ids the player appears
 * in across any of the three perf tables (a member can have no
 * batting row but still be on the team sheet's bowling/fielding card).
 */
export function getMyRecentPerformance(db: Kysely<DB>) {
  return async (email: string, windowDays = 28) => {
    const empty = {
      windowDays,
      matchesPlayed: 0,
      runs: 0,
      wickets: 0,
      catches: 0,
    };

    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .select(["play_cricket_id"])
      .executeTakeFirst();
    if (!member?.play_cricket_id) return empty;

    const sinceIso = formatDate(subDays(new Date(), windowDays), "yyyy-MM-dd");
    const playerId = member.play_cricket_id;

    const batting = await db
      .selectFrom("match_performance_batting")
      .where("player_id", "=", playerId)
      .where("match_date", ">=", sinceIso)
      .select((eb) => eb.fn.sum<string>("runs").as("runs"))
      .executeTakeFirst();

    const bowling = await db
      .selectFrom("match_performance_bowling")
      .where("player_id", "=", playerId)
      .where("match_date", ">=", sinceIso)
      .select((eb) => eb.fn.sum<string>("wickets").as("wickets"))
      .executeTakeFirst();

    const fielding = await db
      .selectFrom("match_performance_fielding")
      .where("player_id", "=", playerId)
      .where("match_date", ">=", sinceIso)
      .select((eb) => eb.fn.sum<string>("catches").as("catches"))
      .executeTakeFirst();

    // matchesPlayed: distinct match_ids across all three tables, since
    // a player can appear in bowling/fielding but not batting (and
    // vice versa). Cheap separate query; the three aggregates above
    // can't capture this without UNION gymnastics.
    const distinctMatches = await db
      .selectFrom(
        db
          .selectFrom("match_performance_batting")
          .where("player_id", "=", playerId)
          .where("match_date", ">=", sinceIso)
          .select("match_id")
          .union(
            db
              .selectFrom("match_performance_bowling")
              .where("player_id", "=", playerId)
              .where("match_date", ">=", sinceIso)
              .select("match_id"),
          )
          .union(
            db
              .selectFrom("match_performance_fielding")
              .where("player_id", "=", playerId)
              .where("match_date", ">=", sinceIso)
              .select("match_id"),
          )
          .as("m"),
      )
      .select((eb) => eb.fn.count<string>("match_id").as("matches"))
      .executeTakeFirst();

    return {
      windowDays,
      matchesPlayed: Number(distinctMatches?.matches ?? 0),
      runs: Number(batting?.runs ?? 0),
      wickets: Number(bowling?.wickets ?? 0),
      catches: Number(fielding?.catches ?? 0),
    };
  };
}

export const BATTING_MILESTONE_RUNS = 50;
export const BOWLING_MILESTONE_WICKETS = 5;

/**
 * Single-game milestone performances (50+ runs batting, 5+ wickets
 * bowling) for the signed-in user in the trailing `windowDays` window
 * (default 7). Powers the home-screen celebration card.
 *
 * Same email → member.play_cricket_id resolution as
 * getMyRecentPerformance: members without a linked Play-Cricket ID get
 * an empty list. A genuine all-round day (fifty AND a five-for in one
 * match) produces two milestones, deliberately — both deserve a shout.
 */
export function getMyRecentMilestones(db: Kysely<DB>) {
  return async (email: string, windowDays = 7) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .select(["play_cricket_id"])
      .executeTakeFirst();
    if (!member?.play_cricket_id) return { windowDays, milestones: [] };

    const sinceIso = formatDate(subDays(new Date(), windowDays), "yyyy-MM-dd");
    const playerId = member.play_cricket_id;

    const batting = await db
      .selectFrom("match_performance_batting")
      .leftJoin(
        "match_result",
        "match_result.match_id",
        "match_performance_batting.match_id",
      )
      .where("match_performance_batting.player_id", "=", playerId)
      .where("match_performance_batting.match_date", ">=", sinceIso)
      .where("match_performance_batting.runs", ">=", BATTING_MILESTONE_RUNS)
      .select([
        "match_performance_batting.match_id as matchId",
        "match_performance_batting.match_date as matchDate",
        "match_performance_batting.team_id as teamId",
        "match_performance_batting.runs",
        "match_performance_batting.not_out as notOut",
        "match_result.home_team_id as homeTeamId",
        "match_result.home_team_name as homeTeamName",
        "match_result.home_club_name as homeClubName",
        "match_result.away_team_name as awayTeamName",
        "match_result.away_club_name as awayClubName",
      ])
      .execute();

    const bowling = await db
      .selectFrom("match_performance_bowling")
      .leftJoin(
        "match_result",
        "match_result.match_id",
        "match_performance_bowling.match_id",
      )
      .where("match_performance_bowling.player_id", "=", playerId)
      .where("match_performance_bowling.match_date", ">=", sinceIso)
      .where(
        "match_performance_bowling.wickets",
        ">=",
        BOWLING_MILESTONE_WICKETS,
      )
      .select([
        "match_performance_bowling.match_id as matchId",
        "match_performance_bowling.match_date as matchDate",
        "match_performance_bowling.team_id as teamId",
        "match_performance_bowling.wickets",
        "match_performance_bowling.runs as runsConceded",
        "match_result.home_team_id as homeTeamId",
        "match_result.home_team_name as homeTeamName",
        "match_result.home_club_name as homeClubName",
        "match_result.away_team_name as awayTeamName",
        "match_result.away_club_name as awayClubName",
      ])
      .execute();

    const milestones = [
      ...batting.map((row) => ({
        type: "batting" as const,
        matchId: row.matchId,
        matchDate: row.matchDate,
        opposition: oppositionFromResult(row),
        runs: row.runs,
        notOut: row.notOut,
      })),
      ...bowling.map((row) => ({
        type: "bowling" as const,
        matchId: row.matchId,
        matchDate: row.matchDate,
        opposition: oppositionFromResult(row),
        wickets: row.wickets,
        runsConceded: row.runsConceded,
      })),
    ].sort((a, b) => b.matchDate.localeCompare(a.matchDate));

    return { windowDays, milestones };
  };
}

/**
 * Opponent display name ("Club 2nd XI") from a joined match_result row,
 * mirroring oppositionName() in the matchday app. The perf row's
 * team_id is always the Percy Main side, so the opponent is whichever
 * of home/away it isn't. Null when the result row hasn't synced yet
 * (left join missed).
 */
function oppositionFromResult(row: {
  teamId: string;
  homeTeamId: string | null;
  homeTeamName: string | null;
  homeClubName: string | null;
  awayTeamName: string | null;
  awayClubName: string | null;
}): string | null {
  if (row.homeTeamId === null) return null;
  const home = row.homeTeamId === row.teamId;
  const club = home ? row.awayClubName : row.homeClubName;
  const team = home ? row.awayTeamName : row.homeTeamName;
  if (!club) return team;
  if (!team || team === club) return club;
  return `${club} ${team}`;
}

export function recordExpense(db: Kysely<DB>, s3: S3Uploader) {
  return async (
    userId: string,
    role: string,
    data: RecordExpense & { matchId: string },
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", data.matchId)
      .select(["id", "play_cricket_team_id", "status", "match_date"])
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    if (matchday.status === "cancelled") {
      throwHttpError(400, "Cannot add expenses to a cancelled matchday.");
    }

    // Amendments §1/§4: expenses are open from matchday creation
    // through match_date + 5 days. After that the option is hard-closed
    // (no soft override).
    if (isPastExpenseCutoff(matchday.match_date)) {
      throwHttpError(400, "Expense window closed (5 days after match date).");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const receiptImageUrl = await uploadReceiptImage(data.receiptImage, id, s3);

    // On a finished matchday the draft -> submitted auto-flip in
    // finishMatch has already run, so a fresh draft would be invisible
    // to the treasurer forever. Insert as submitted instead.
    const isPostFinish = matchday.status === "finished";

    await db
      .insertInto("matchday_expense")
      .values({
        id,
        matchday_id: data.matchId,
        expense_type: data.type,
        description: data.description ?? null,
        amount_pence: data.amountPence,
        created_by: userId,
        created_at: now,
        receipt_image_url: receiptImageUrl,
        ...(isPostFinish && {
          status: "submitted",
          submitted_at: now,
        }),
      })
      .execute();

    return { expenseId: id };
  };
}

export function updateExpense(db: Kysely<DB>) {
  return async (userId: string, role: string, data: UpdateExpense) => {
    const expense = await db
      .selectFrom("matchday_expense")
      .innerJoin("matchday", "matchday.id", "matchday_expense.matchday_id")
      .where("matchday_expense.id", "=", data.expenseId)
      .select([
        "matchday_expense.id",
        "matchday.play_cricket_team_id",
        "matchday.status as matchday_status",
      ])
      .executeTakeFirst();

    if (!expense) throwHttpError(404, "Expense not found");

    if (expense.matchday_status === "finished") {
      throwHttpError(400, "Cannot update expenses on a finished matchday");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(expense.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    await db
      .updateTable("matchday_expense")
      .set({
        expense_type: data.type,
        description: data.description,
        amount_pence: data.amountPence,
      })
      .where("id", "=", data.expenseId)
      .execute();

    return { success: true };
  };
}

export function deleteExpense(db: Kysely<DB>) {
  return async (userId: string, role: string, expenseId: string) => {
    const expense = await db
      .selectFrom("matchday_expense")
      .innerJoin("matchday", "matchday.id", "matchday_expense.matchday_id")
      .where("matchday_expense.id", "=", expenseId)
      .select([
        "matchday_expense.id",
        "matchday.play_cricket_team_id",
        "matchday.status as matchday_status",
      ])
      .executeTakeFirst();

    if (!expense) throwHttpError(404, "Expense not found");

    if (expense.matchday_status === "finished") {
      throwHttpError(400, "Cannot delete expenses from a finished matchday");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(expense.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    await db
      .deleteFrom("matchday_expense")
      .where("id", "=", expenseId)
      .execute();

    return { success: true };
  };
}

// ── Official panel services ──

export function listTeams(db: Kysely<DB>) {
  return async (userId: string, role: string) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);

    if (accessibleIds.length === 0) {
      return [];
    }

    const teams = await db
      .selectFrom("play_cricket_team")
      .where("id", "in", accessibleIds)
      .select(["id", "name", "is_junior"])
      .orderBy("name", "asc")
      .execute();

    return teams.filter((t): t is typeof t & { id: string } => t.id !== null);
  };
}

export function getUpcomingMatches(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient,
  siteId: string,
) {
  return async (userId: string, role: string, teamId: string) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    // Fetch both current and next season when in Jan-Mar
    const seasons =
      now.getMonth() < 3 ? [currentYear - 1, currentYear] : [currentYear];
    const summaries = await Promise.all(
      seasons.map((season) => playCricketApi.getMatchesSummary(season)),
    );
    const allMatches = summaries.flatMap((s) => s.matches);

    // Filter to matches involving this team, from today onwards
    const cutoff = startOfDay(subDays(now, 1));

    const upcoming = allMatches
      .filter((m) => {
        const isOurTeam =
          (m.home_club_id === siteId && m.home_team_id === teamId) ||
          (m.away_club_id === siteId && m.away_team_id === teamId);
        if (!isOurTeam) return false;

        const matchDate = parse(m.match_date, "dd/MM/yyyy", new Date());
        return !isBefore(matchDate, cutoff);
      })
      .map((m) => {
        const isHome = m.home_club_id === siteId;
        return {
          matchId: m.id.toString(),
          matchDate: m.match_date,
          matchTime: m.match_time ?? null,
          opposition: isHome
            ? `${m.away_club_name} ${m.away_team_name}`
            : `${m.home_club_name} ${m.home_team_name}`,
          isHome,
          competitionName: m.competition_name ?? null,
          competitionType: m.competition_type ?? null,
        };
      })
      .sort((a, b) => {
        const dateA = parse(a.matchDate, "dd/MM/yyyy", new Date());
        const dateB = parse(b.matchDate, "dd/MM/yyyy", new Date());
        return dateA.getTime() - dateB.getTime();
      });

    // Check which matches already have a matchday record. Cancelled
    // matchdays are hidden so a rescheduled fixture surfaces as
    // creatable again.
    const existingMatchdays = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", teamId)
      .where("status", "!=", "cancelled")
      .selectAll()
      .execute();

    const matchdayByDate = new Map(
      existingMatchdays.map((md) => [md.match_date, md]),
    );

    return upcoming.map((m) => {
      const [dd, mm, yyyy] = m.matchDate.split("/");
      const isoDate = `${yyyy}-${mm}-${dd}`;
      const existingMatchday = matchdayByDate.get(isoDate);

      return {
        ...m,
        matchdayId: existingMatchday?.id ?? null,
        matchdayStatus: existingMatchday?.status ?? null,
      };
    });
  };
}

/**
 * Custom fixtures — matchdays created by officials with no
 * Play-Cricket match behind them (friendlies and other club-arranged
 * games). The matchday app's fixtures tab unions these into the
 * Play-Cricket feed, so they're visible to any signed-in member —
 * mirroring the team-sheet route, which is already member-visible.
 * The trailing window keeps recently played games listed alongside
 * Play-Cricket results rather than vanishing at midnight.
 */
export function listCustomFixtures(db: Kysely<DB>) {
  return async () => {
    const windowStart = formatDate(
      subDays(startOfDay(new Date()), 30),
      "yyyy-MM-dd",
    );

    const rows = await db
      .selectFrom("matchday")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .where("matchday.play_cricket_match_id", "is", null)
      .where("matchday.status", "!=", "cancelled")
      .where("matchday.match_date", ">=", windowStart)
      .select([
        "matchday.id",
        "matchday.match_date",
        "matchday.match_time",
        "matchday.opposition",
        "matchday.is_home",
        "matchday.competition_type",
        "matchday.status",
        "matchday.result_type",
        "matchday.play_cricket_team_id",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("matchday.match_date", "asc")
      .execute();

    return rows.map((r) => ({
      matchdayId: r.id,
      matchDate: r.match_date,
      matchTime: r.match_time,
      opposition: r.opposition,
      teamId: r.play_cricket_team_id,
      teamName: r.team_name,
      isHome: r.is_home,
      competitionType: r.competition_type,
      status: r.status,
      resultType: r.result_type,
    }));
  };
}

/**
 * Past unfinished matchdays for a team — matchdays whose match_date is
 * before today and whose status is still pending or confirmed. Lets
 * officials find and finish/cancel matchdays they started but never
 * closed out (the upcoming-matches view only goes forward in time).
 */
export function getPastUnfinishedMatchdays(db: Kysely<DB>) {
  return async (userId: string, role: string, teamId: string) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    const today = formatDate(startOfDay(new Date()), "yyyy-MM-dd");

    const matchdays = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", teamId)
      .where("status", "in", ["pending", "confirmed"])
      .where("match_date", "<", today)
      .select(["id", "match_date", "opposition", "status", "competition_type"])
      .orderBy("match_date", "desc")
      .execute();

    return matchdays;
  };
}

/**
 * All past-unfinished matchdays across every team the user has access
 * to. Powers the home dashboard's "Needs attention" card without
 * forcing the client to fan out per-team queries.
 */
export function getAllPastUnfinishedMatchdays(db: Kysely<DB>) {
  return async (userId: string, role: string) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (accessibleIds.length === 0) return [];

    const today = formatDate(startOfDay(new Date()), "yyyy-MM-dd");

    return db
      .selectFrom("matchday")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .where("matchday.play_cricket_team_id", "in", accessibleIds)
      .where("matchday.status", "in", ["pending", "confirmed"])
      .where("matchday.match_date", "<", today)
      .select([
        "matchday.id",
        "matchday.match_date",
        "matchday.opposition",
        "matchday.status",
        "matchday.competition_type",
        "matchday.play_cricket_match_id",
        "play_cricket_team.id as team_id",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("matchday.match_date", "desc")
      .execute();
  };
}

export function createMatchday(db: Kysely<DB>) {
  return async (userId: string, role: string, data: CreateMatchday) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(data.teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    // Check no existing matchday for this team + date. A previously
    // cancelled matchday is ignored so a rescheduled fixture on the
    // same date can be re-created.
    const existing = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", data.teamId)
      .where("match_date", "=", data.matchDate)
      .where("status", "!=", "cancelled")
      .select("id")
      .executeTakeFirst();

    if (existing) {
      throwHttpError(409, "A matchday already exists for this team and date");
    }

    // If an availability request is still open covering this (team, date),
    // refuse: creating the matchday now snapshots an empty (or half-picked)
    // squad, and subsequent assignPlayer calls never propagate. Matchdays
    // are materialised when the request closes - see updateRequestStatus.
    // Match on (team, date) rather than playCricketMatchId so callers that
    // omit the match id still hit the guard.
    const openRequest = await db
      .selectFrom("availability_fixture")
      .innerJoin(
        "availability_request",
        "availability_request.id",
        "availability_fixture.availability_request_id",
      )
      .where("availability_fixture.play_cricket_team_id", "=", data.teamId)
      .where("availability_fixture.match_date", "=", data.matchDate)
      .where("availability_request.status", "=", "open")
      .select("availability_request.id")
      .executeTakeFirst();

    if (openRequest) {
      throwHttpError(
        409,
        "An availability request is still open for this match - close it to confirm the squad",
      );
    }

    const id = crypto.randomUUID();
    let importedPlayers = 0;
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("matchday")
        .values({
          id,
          play_cricket_team_id: data.teamId,
          match_date: data.matchDate,
          opposition: data.opposition,
          competition_type: data.competitionType ?? null,
          play_cricket_match_id: data.playCricketMatchId ?? null,
          is_home: data.isHome ?? null,
          match_time: data.matchTime ?? null,
          status: "pending",
          created_by: userId,
        })
        .execute();

      // If an availability_fixture matches this Play Cricket match, copy
      // any pre-existing assignments straight into matchday_player so
      // the squad-picker page doesn't open empty. Pre-amendment this
      // was done by an explicit "Confirm teams" step on the per-date
      // picker; we run it implicitly here instead.
      if (data.playCricketMatchId) {
        const assignments = await trx
          .selectFrom("availability_assignment")
          .innerJoin(
            "availability_fixture",
            "availability_fixture.id",
            "availability_assignment.availability_fixture_id",
          )
          .where(
            "availability_fixture.play_cricket_match_id",
            "=",
            data.playCricketMatchId,
          )
          .where("availability_fixture.play_cricket_team_id", "=", data.teamId)
          .select([
            "availability_assignment.member_id",
            "availability_assignment.dependent_id",
            "availability_assignment.player_name",
          ])
          .orderBy("availability_assignment.position", "asc")
          .execute();

        if (assignments.length > 0) {
          await trx
            .insertInto("matchday_player")
            .values(
              assignments.map((a) => ({
                id: crypto.randomUUID(),
                matchday_id: id,
                member_id: a.member_id,
                // Carry the junior linkage through so a dependent picked
                // via the availability picker doesn't collapse into an
                // anonymous guest row on direct matchday creation.
                dependent_id: a.dependent_id,
                player_name: a.player_name,
                status: "selected" as const,
              })),
            )
            .execute();
          importedPlayers = assignments.length;
        }
      }
    });

    return { id, importedPlayers };
  };
}

export function searchMembers(db: Kysely<DB>) {
  return async (params: SearchMembers) => {
    const term = `%${params.query.trim()}%`;

    const [members, dependents] = await Promise.all([
      db
        .selectFrom("member")
        .where("name", "ilike", term)
        .where("deleted_at", "is", null)
        .select(["id", "name", "email", "member_category"])
        .orderBy("name", "asc")
        .limit(20)
        .execute(),
      db
        .selectFrom("dependent")
        .innerJoin("member as parent", "parent.id", "dependent.member_id")
        .where("dependent.name", "ilike", term)
        .where("parent.deleted_at", "is", null)
        .select([
          "dependent.id as id",
          "dependent.name as name",
          "parent.name as parent_name",
        ])
        .orderBy("dependent.name", "asc")
        .limit(20)
        .execute(),
    ]);

    return [
      ...members.map((m) => ({ type: "member" as const, ...m })),
      ...dependents.map((d) => ({ type: "dependent" as const, ...d })),
    ];
  };
}

export function addPlayer(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    data: AddPlayer,
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .select(["id", "play_cricket_team_id", "status"])
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    if (matchday.status === "finished" || matchday.status === "cancelled") {
      throwHttpError(
        400,
        `Cannot add players to a ${matchday.status} matchday`,
      );
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    if (data.memberId && data.dependentId) {
      throwHttpError(400, "Pick a member or a junior, not both");
    }

    // Check for duplicate member in squad
    if (data.memberId) {
      const existing = await db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .where("member_id", "=", data.memberId)
        .where("status", "in", ["selected", "playing"])
        .select("id")
        .executeTakeFirst();

      if (existing) {
        throwHttpError(409, "This player is already in the squad");
      }
    }

    if (data.dependentId) {
      const existing = await db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .where("dependent_id", "=", data.dependentId)
        .where("status", "in", ["selected", "playing"])
        .select("id")
        .executeTakeFirst();

      if (existing) {
        throwHttpError(409, "This player is already in the squad");
      }
    }

    const id = crypto.randomUUID();

    await db.transaction().execute(async (trx) => {
      let finalMemberId = data.memberId ?? null;

      // Create guest member record for ad-hoc players (no memberId and
      // no dependentId). Guests have no real contact details — leave the
      // nullable fields as NULL rather than "", which used to collide on
      // the member_email_unique index.
      if (!data.memberId && !data.dependentId && data.playerName.trim()) {
        finalMemberId = crypto.randomUUID();
        await trx
          .insertInto("member")
          .values({
            id: finalMemberId,
            name: data.playerName,
            member_category: "guest",
          })
          .execute();
      }

      await trx
        .insertInto("matchday_player")
        .values({
          id,
          matchday_id: matchdayId,
          member_id: finalMemberId,
          dependent_id: data.dependentId ?? null,
          player_name: data.playerName,
          status: "selected",
        })
        .execute();
    });

    return { id };
  };
}

export function removePlayer(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    playerId: string,
  ) => {
    const player = await db
      .selectFrom("matchday_player")
      .innerJoin("matchday", "matchday.id", "matchday_player.matchday_id")
      .where("matchday_player.id", "=", playerId)
      .where("matchday_player.matchday_id", "=", matchdayId)
      .select([
        "matchday_player.id",
        "matchday.play_cricket_team_id",
        "matchday.status as matchday_status",
      ])
      .executeTakeFirst();

    if (!player) throwHttpError(404, "Player not found");

    if (
      player.matchday_status === "finished" ||
      player.matchday_status === "cancelled"
    ) {
      throwHttpError(
        400,
        `Cannot remove players from a ${player.matchday_status} matchday`,
      );
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(player.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    await db.deleteFrom("matchday_player").where("id", "=", playerId).execute();

    return { success: true };
  };
}

// `confirmTeam` was removed in the matchday amendments rework: picking a
// provisional team is now just assignment via addPlayer/removePlayer, and
// the charges + status flip the old endpoint did now live in finishMatch
// (post-match wrap). See docs/plans/matchday/amendments.md §2 + §4.

export function setMatchRoles(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    data: SetRoles,
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .select(["id", "play_cricket_team_id", "status"])
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    if (matchday.status === "finished") {
      throwHttpError(400, "Cannot change roles on a finished matchday");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    const targetIds = [data.captainPlayerId, data.wicketkeeperPlayerId].filter(
      (id): id is string => id !== null,
    );

    if (targetIds.length > 0) {
      const validPlayers = await db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .where("id", "in", targetIds)
        .select("id")
        .execute();

      const validIds = new Set(validPlayers.map((p) => p.id));
      const invalid = targetIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throwHttpError(
          400,
          "One or more player IDs do not belong to this matchday",
        );
      }
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("matchday_player")
        .set({ is_captain: false })
        .where("matchday_id", "=", matchdayId)
        .where("is_captain", "=", true)
        .execute();

      await trx
        .updateTable("matchday_player")
        .set({ is_wicketkeeper: false })
        .where("matchday_id", "=", matchdayId)
        .where("is_wicketkeeper", "=", true)
        .execute();

      if (data.captainPlayerId) {
        await trx
          .updateTable("matchday_player")
          .set({ is_captain: true })
          .where("id", "=", data.captainPlayerId)
          .where("matchday_id", "=", matchdayId)
          .execute();
      }

      if (data.wicketkeeperPlayerId) {
        await trx
          .updateTable("matchday_player")
          .set({ is_wicketkeeper: true })
          .where("id", "=", data.wicketkeeperPlayerId)
          .where("matchday_id", "=", matchdayId)
          .execute();
      }
    });

    return { success: true };
  };
}

export function markFeePaid(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    playerId: string,
    data: { paymentMethod: string },
  ) => {
    const player = await db
      .selectFrom("matchday_player")
      .innerJoin("matchday", "matchday.id", "matchday_player.matchday_id")
      .where("matchday_player.id", "=", playerId)
      .where("matchday_player.matchday_id", "=", matchdayId)
      .select([
        "matchday_player.id",
        "matchday_player.charge_id",
        "matchday.play_cricket_team_id",
      ])
      .executeTakeFirst();

    if (!player) throwHttpError(404, "Player not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(player.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    if (!player.charge_id) {
      throwHttpError(400, "No match donation charge found for this player");
    }

    await db
      .updateTable("charge")
      .set({
        paid_at: new Date().toISOString(),
        payment_method: data.paymentMethod,
      })
      .where("id", "=", player.charge_id)
      .where("paid_at", "is", null)
      // Captain shouldn't be marking a waived charge paid.
      .where("relieved_at", "is", null)
      .execute();

    return { success: true };
  };
}

export function cancelMatchday(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    data: CancelMatchday,
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .select(["id", "play_cricket_team_id", "status"])
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    if (matchday.status !== "pending" && matchday.status !== "confirmed") {
      throwHttpError(
        400,
        matchday.status === "cancelled"
          ? "Matchday is already cancelled"
          : "Cannot cancel a finished matchday",
      );
    }

    // Block if any non-deleted, non-relieved match-fee charge already
    // exists. The user-facing rule is "close off without charging" — if
    // unpaid charges already exist, treasurer needs to void/refund them
    // through the normal flow first. Relieved charges carry no debt and
    // are safe to leave in place when cancelling.
    const existingCharge = await db
      .selectFrom("matchday_player")
      .innerJoin("charge", "charge.id", "matchday_player.charge_id")
      .where("matchday_player.matchday_id", "=", matchdayId)
      .where("charge.deleted_at", "is", null)
      .where("charge.relieved_at", "is", null)
      .select("charge.id")
      .executeTakeFirst();

    if (existingCharge) {
      throwHttpError(
        400,
        "Cannot cancel: match donation charges already exist. Void them via the Charges admin first.",
      );
    }

    await db
      .updateTable("matchday")
      .set({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId,
        cancelled_reason: data.reason ?? null,
      })
      .where("id", "=", matchdayId)
      .execute();

    return { success: true };
  };
}

export function finishMatch(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    data: FinishMatch,
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .selectAll()
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    // The wrap-up flow accepts pending or confirmed matchdays - a
    // captain who never went through the (now-removed) pre-match
    // confirm step still lands here. Re-submitting the result on a
    // finished matchday is allowed and idempotent.
    if (matchday.status === "cancelled") {
      throwHttpError(400, "Cannot finish a cancelled matchday");
    }

    const playerStatuses = data.playerStatuses ?? [];
    const playerIds = playerStatuses.map((ps) => ps.matchdayPlayerId);
    if (playerIds.length > 0) {
      const validPlayers = await db
        .selectFrom("matchday_player")
        .where("matchday_id", "=", matchdayId)
        .where("id", "in", playerIds)
        .select("id")
        .execute();
      const validIds = new Set(validPlayers.map((p) => p.id));
      const invalid = playerIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throwHttpError(
          400,
          "One or more player IDs do not belong to this matchday",
        );
      }
    }

    const overrides = new Map(
      (data.feeOverrides ?? []).map((o) => [o.matchdayPlayerId, o.amountPence]),
    );

    const isFirstFinish = matchday.status !== "finished";
    const finishedAt = new Date().toISOString();

    // Validate that every player who will end up "playing" can have a
    // fee resolved (either from a match_fee_rate row or from a
    // feeOverride). Done before the status flip so the matchday can't
    // get stuck half-finished if the captain forgot an override.
    if (isFirstFinish) {
      const statusOverrides = new Map(
        playerStatuses.map((p) => [p.matchdayPlayerId, p.status]),
      );
      const players = await db
        .selectFrom("matchday_player")
        .leftJoin("member", "member.id", "matchday_player.member_id")
        .leftJoin("dependent", "dependent.id", "matchday_player.dependent_id")
        .where("matchday_player.matchday_id", "=", matchdayId)
        .where("matchday_player.charge_id", "is", null)
        .select([
          "matchday_player.id as matchdayPlayerId",
          "matchday_player.player_name",
          "matchday_player.member_id",
          "matchday_player.dependent_id",
          "matchday_player.status as current_status",
          "member.member_category",
          "dependent.member_id as dependentParentId",
        ])
        .execute();
      const feeRates = await db
        .selectFrom("match_fee_rate")
        .where((eb) =>
          eb.or([
            eb("play_cricket_team_id", "=", matchday.play_cricket_team_id),
            eb("play_cricket_team_id", "is", null),
          ]),
        )
        .selectAll()
        .execute();
      // A team with zero team-specific fee rates is intentionally
      // fee-free (e.g. women's softball - the club deliberately leaves
      // no match_fee_rate row for that team). Global / null-team rates
      // still apply to guests, but they shouldn't force "missing fee"
      // errors on the captains of fee-free teams. Only validate when
      // the team has at least one rate of its own configured - that's
      // when "we charge most of the team but accidentally skipped a
      // category" becomes the likely interpretation.
      const teamHasOwnRate = feeRates.some(
        (r) => r.play_cricket_team_id === matchday.play_cricket_team_id,
      );
      if (teamHasOwnRate) {
        const missing: string[] = [];
        for (const p of players) {
          // "selected" is the pre-finish squad-picked state; if the captain
          // submits the wrap without an explicit per-player status, default
          // to playing so we still charge them.
          const effectiveStatus =
            statusOverrides.get(p.matchdayPlayerId) ?? p.current_status;
          const willPlay =
            effectiveStatus === "playing" || effectiveStatus === "selected";
          if (!willPlay) continue;
          let category: string | null = null;
          if (p.member_id) {
            category = p.member_category ?? "guest";
          } else if (p.dependent_id && p.dependentParentId) {
            category = "junior";
          }
          if (!category) continue;
          if (overrides.has(p.matchdayPlayerId)) continue;
          const rate = findFeeRate(
            feeRates,
            matchday.play_cricket_team_id,
            matchday.competition_type,
            category,
          );
          if (!rate) missing.push(p.player_name);
        }
        if (missing.length > 0) {
          throwHttpError(
            400,
            `Missing fee for: ${missing.join(", ")}. Captain must enter an amount inline.`,
          );
        }
      }
    }

    // All status / charge / expense writes commit atomically: a partial
    // failure would leave the matchday flagged "finished" with the
    // first-finish branch (charges, draft expense submission) skipped
    // forever on retry.
    let chargesCreated = 0;
    await db.transaction().execute(async (trx) => {
      // Lock the matchday row before touching any matchday_player rows.
      // Withdraw (and cancel) take the matchday lock first too, so finishing
      // now uses the same order - they serialise instead of deadlocking
      // AB-BA (finish used to lock player rows first, then the matchday).
      // Re-read status under the lock so it's authoritative: a cancel that
      // committed after the access check above is caught here, and the
      // first-finish charge branch keys off the locked status so two
      // concurrent finishes can't both create charges.
      const locked = await trx
        .selectFrom("matchday")
        .where("id", "=", matchdayId)
        .select("status")
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throwHttpError(404, "Matchday not found");
      if (locked.status === "cancelled") {
        throwHttpError(400, "Cannot finish a cancelled matchday");
      }
      const firstFinish = locked.status !== "finished";

      for (const { matchdayPlayerId, status } of playerStatuses) {
        await trx
          .updateTable("matchday_player")
          .set({ status })
          .where("id", "=", matchdayPlayerId)
          .where("matchday_id", "=", matchdayId)
          .execute();
      }

      await trx
        .updateTable("matchday")
        .set({
          status: "finished",
          confirmed_at: matchday.confirmed_at ?? finishedAt,
          confirmed_by: matchday.confirmed_by ?? userId,
          finished_at: matchday.finished_at ?? finishedAt,
          finished_by: matchday.finished_by ?? userId,
          result_type: data.resultType,
          result_confirmed_at: finishedAt,
          result_confirmed_by: userId,
          result_source: "manual",
        })
        .where("id", "=", matchdayId)
        .execute();

      if (!firstFinish) return;

      // Any player still "selected" at finish time played - the captain
      // just didn't send an explicit per-player status. Normalise them
      // to "playing" so the charge loop's `status = "playing"` filter
      // doesn't silently skip them.
      await trx
        .updateTable("matchday_player")
        .set({ status: "playing" })
        .where("matchday_id", "=", matchdayId)
        .where("status", "=", "selected")
        .execute();

      // Submit all draft expenses for treasurer review
      await trx
        .updateTable("matchday_expense")
        .set({
          status: "submitted",
          submitted_at: finishedAt,
        })
        .where("matchday_id", "=", matchdayId)
        .where("status", "=", "draft")
        .execute();

      // Create charges for any playing players who don't have one yet.
      // Mirrors the confirmTeam fee loop, including the dependent path
      // (junior rate against the parent + charge_dependent link), so a
      // matchday finished without an explicit confirm doesn't drop
      // junior donations.
      const uncharged = await trx
        .selectFrom("matchday_player")
        .leftJoin("member", "member.id", "matchday_player.member_id")
        .leftJoin("dependent", "dependent.id", "matchday_player.dependent_id")
        .where("matchday_player.matchday_id", "=", matchdayId)
        .where("matchday_player.status", "=", "playing")
        .where("matchday_player.charge_id", "is", null)
        .select([
          "matchday_player.id as matchdayPlayerId",
          "matchday_player.member_id",
          "matchday_player.dependent_id",
          "matchday_player.player_name",
          "member.member_category",
          "dependent.member_id as dependentParentId",
          "dependent.name as dependentName",
        ])
        .execute();

      if (uncharged.length === 0) return;

      const feeRates = await trx
        .selectFrom("match_fee_rate")
        .where((eb) =>
          eb.or([
            eb("play_cricket_team_id", "=", matchday.play_cricket_team_id),
            eb("play_cricket_team_id", "is", null),
          ]),
        )
        .selectAll()
        .execute();

      // A team with zero team-specific rates is fee-free by design:
      // ignore global / null-team fallback rates entirely so a generic
      // guest-default doesn't sneak a charge onto a women's softball
      // match. Inline overrides from the captain still apply.
      const teamHasOwnRateForCharges = feeRates.some(
        (r) => r.play_cricket_team_id === matchday.play_cricket_team_id,
      );

      const applyRelief = applyReliefIfAny(trx);
      for (const player of uncharged) {
        let chargeMemberId: string;
        let category: string;
        let chargeDependentId: string | null = null;
        let descriptionSuffix = "";

        if (player.member_id) {
          chargeMemberId = player.member_id;
          category = player.member_category ?? "guest";
        } else if (player.dependent_id && player.dependentParentId) {
          chargeMemberId = player.dependentParentId;
          category = "junior";
          chargeDependentId = player.dependent_id;
          descriptionSuffix = player.dependentName
            ? ` for ${player.dependentName}`
            : "";
        } else {
          continue;
        }

        const rate = teamHasOwnRateForCharges
          ? findFeeRate(
              feeRates,
              matchday.play_cricket_team_id,
              matchday.competition_type,
              category,
            )
          : undefined;
        const overrideAmount = overrides.get(player.matchdayPlayerId);
        const amountPence = overrideAmount ?? rate?.amount_pence ?? 0;

        if (amountPence === 0) continue;

        const chargeId = crypto.randomUUID();
        await trx
          .insertInto("charge")
          .values({
            id: chargeId,
            member_id: chargeMemberId,
            description: `Match donation - ${matchday.opposition} (${formatDate(new Date(matchday.match_date), "dd/MM/yyyy")})${descriptionSuffix}`,
            amount_pence: amountPence,
            charge_date: matchday.match_date,
            created_by: userId,
            type: "match_fee",
            source: "matchday",
          })
          .execute();

        await trx
          .updateTable("matchday_player")
          .set({ charge_id: chargeId })
          .where("id", "=", player.matchdayPlayerId)
          .execute();

        if (chargeDependentId) {
          await trx
            .insertInto("charge_dependent")
            .values({
              charge_id: chargeId,
              dependent_id: chargeDependentId,
            })
            .execute();
        }

        await applyRelief({
          chargeId,
          memberId: chargeMemberId,
          type: "match_fee",
          chargeDate: matchday.match_date,
        });
        chargesCreated++;
      }
    });

    // Notifications are no longer sent here. Wrapping up only creates the
    // charges; the captain sends the donation-request batch separately
    // (notifyMatchCharges) once they've marked off anyone who paid cash /
    // bank transfer at the ground. On a result re-submission isFirstFinish
    // is false, so chargesCreated stays 0.
    return { success: true, chargesCreated };
  };
}

/**
 * Send the match-fee donation-request batch for a finished matchday.
 *
 * Split out from finishMatch (amendments §5 follow-up): a captain wraps
 * up the match, marks off whoever paid on the day, *then* notifies only
 * the players still owing. One-shot - once `charges_notified_at` is set
 * the endpoint refuses to re-send, so a player marked paid after the
 * batch is never re-nagged and late squad additions are handled via the
 * charges admin rather than a second blast.
 *
 * Join `member` via `charge.member_id` (not `matchday_player.member_id`)
 * so junior donations - which sit on the parent's member row - also get
 * a notification. Only unpaid, non-deleted, non-relieved charges are
 * included.
 */
export function notifyMatchCharges(
  db: Kysely<DB>,
  sendEmail: (email: {
    to: string;
    subject: string;
    html: string;
  }) => Promise<void>,
  sendPush: SendPush,
  config: { BASE_URL: string; MATCHDAY_URL?: string },
) {
  const fetchPrefs = getNotificationPreferencesByUserIds(db);
  const fetchPushSubs = listPushSubscriptionsForUsers(db);
  const pruneSubscription = deletePushSubscriptionByEndpoint(db);
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    log: FastifyBaseLogger,
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .select(["id", "status", "play_cricket_team_id", "charges_notified_at"])
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    if (matchday.status !== "finished") {
      throwHttpError(400, "Wrap up the match before sending donation requests");
    }

    // One-shot: a captain can only fire the batch once. Re-sends would
    // re-nag players who've since paid. Cheap fast-path so the common
    // re-tap returns a clear error without touching the DB again - but
    // the authoritative guard is the conditional claim below.
    if (matchday.charges_notified_at) {
      throwHttpError(400, "Donation requests have already been sent");
    }

    // Claim the batch atomically BEFORE sending anything: stamp the row
    // only while charges_notified_at is still null. Two captains tapping
    // "send" at once would both pass the read-side check above, so the
    // conditional UPDATE is what actually serialises them - the loser
    // updates zero rows and bails before delivering a duplicate blast.
    // Claiming up-front (rather than after the send) means a crash
    // mid-delivery leaves the match marked notified, which is the right
    // call for a one-shot: better a few undelivered than a re-blast.
    const claim = await db
      .updateTable("matchday")
      .set({
        charges_notified_at: new Date().toISOString(),
        charges_notified_by: userId,
      })
      .where("id", "=", matchdayId)
      .where("status", "=", "finished")
      .where("charges_notified_at", "is", null)
      .executeTakeFirst();
    if (claim.numUpdatedRows === 0n) {
      throwHttpError(400, "Donation requests have already been sent");
    }

    const unpaidPlayers = await db
      .selectFrom("matchday_player")
      .innerJoin("charge", "charge.id", "matchday_player.charge_id")
      .innerJoin("member", "member.id", "charge.member_id")
      .where("matchday_player.matchday_id", "=", matchdayId)
      .where("charge.paid_at", "is", null)
      .where("charge.deleted_at", "is", null)
      // Don't nag members about charges the club has waived.
      .where("charge.relieved_at", "is", null)
      .select([
        "charge.id as charge_id",
        "member.name as member_name",
        "member.email as member_email",
        "charge.description as charge_description",
        "charge.amount_pence",
        "charge.charge_date",
      ])
      .execute();

    const currencyFormatter = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    });

    const { render } = await import("react-email");
    const { ChargeNotification } = await import("@percy-main/email");

    // Resolve user ids so we can apply each recipient's matchday_channel
    // preference. Member rows whose email doesn't match a user (legacy
    // members who never registered) get email-only delivery, matching
    // pre-push behavior.
    const recipientEmails = unpaidPlayers
      .map((p) => p.member_email?.toLowerCase())
      .filter((e): e is string => Boolean(e));

    const userRows =
      recipientEmails.length > 0
        ? await db
            .selectFrom("user")
            .where("email", "in", recipientEmails)
            .select(["id", "email"])
            .execute()
        : [];
    const userIdByEmail = new Map<string, string>();
    for (const u of userRows) {
      userIdByEmail.set(u.email.toLowerCase(), u.id);
    }
    const userIds = userRows.map((u) => u.id);

    const [prefs, pushSubsByUser] = await Promise.all([
      fetchPrefs(userIds),
      fetchPushSubs(userIds),
    ]);

    let emailsSent = 0;
    const emailErrors: string[] = [];

    const sendOneEmail = async (
      player: (typeof unpaidPlayers)[number],
      amountFormatted: string,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      try {
        const element = ChargeNotification.component({
          imageBaseUrl: `${config.BASE_URL}/images`,
          name: player.member_name ?? "Member",
          description: player.charge_description,
          amount: amountFormatted,
          chargeDate: formatDate(new Date(player.charge_date), "dd/MM/yyyy"),
          loginUrl: `${config.BASE_URL}/auth/login`,
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        const html = await render(element as any);
        await sendEmail({
          to: player.member_email ?? "",
          subject: ChargeNotification.subject,
          html,
        });
        return { ok: true };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error(
          {
            err,
            recipientEmail: player.member_email,
            matchdayId,
            channel: "email",
          },
          "matchday_charge_notification_failed",
        );
        return { ok: false, reason };
      }
    };

    for (const player of unpaidPlayers) {
      if (!player.member_email) continue;

      const amountFormatted = currencyFormatter.format(
        player.amount_pence / 100,
      );

      const recipientUserId = userIdByEmail.get(
        player.member_email.toLowerCase(),
      );
      const channel: MatchdayChannel = recipientUserId
        ? (prefs.get(recipientUserId) ?? DEFAULT_MATCHDAY_CHANNEL)
        : "email";

      const wantsEmail = channel === "email" || channel === "both";
      const wantsPush = channel === "push" || channel === "both";

      const subscriptions = recipientUserId
        ? (pushSubsByUser.get(recipientUserId) ?? [])
        : [];
      const pushAvailable = wantsPush && subscriptions.length > 0;

      let deliveredAny = false;
      let recipientFailure: string | null = null;

      // Push-only recipients with no live subscriptions fall back to
      // email - opt-in subscriptions plus a payment ask is too easy to
      // miss otherwise.
      if (wantsEmail || (wantsPush && !pushAvailable)) {
        const result = await sendOneEmail(player, amountFormatted);
        if (result.ok) {
          deliveredAny = true;
        } else {
          recipientFailure = result.reason;
        }
      }

      if (pushAvailable) {
        // The matchday PWA's service worker registered this subscription,
        // so opening the URL on that origin keeps the user inside the app
        // and at the new in-app pay-outstanding flow. Fall back to the
        // main-site payments tab when MATCHDAY_URL is unset (dev/preview).
        const payUrl = config.MATCHDAY_URL
          ? `${config.MATCHDAY_URL}/donations`
          : `${config.BASE_URL}/members?tab=payments`;
        const payload = {
          title: ChargeNotification.subject,
          body: `${amountFormatted} - ${player.charge_description}`,
          url: payUrl,
          tag: `charge:${player.charge_id}`,
        };
        let pushDelivered = false;
        let allGone = true;
        for (const sub of subscriptions) {
          const result = await sendPush(sub, payload);
          if (result.ok) {
            deliveredAny = true;
            pushDelivered = true;
            allGone = false;
          } else if (result.gone) {
            await pruneSubscription(result.endpoint);
            log.info(
              {
                matchdayId,
                chargeId: player.charge_id,
                endpoint: result.endpoint,
              },
              "push_subscription_gone_pruned",
            );
          } else {
            allGone = false;
            log.warn(
              {
                matchdayId,
                chargeId: player.charge_id,
                recipientEmail: player.member_email,
                endpoint: result.endpoint,
                reason: result.reason,
                channel: "push",
              },
              "matchday_charge_notification_failed",
            );
            recipientFailure ??= result.reason;
          }
        }

        // Push-only recipient whose every subscription was pruned this
        // turn looks subscribed in our store but the push service
        // disagrees - email them so they don't silently miss the charge.
        if (!wantsEmail && !pushDelivered && allGone) {
          const fallback = await sendOneEmail(player, amountFormatted);
          if (fallback.ok) {
            deliveredAny = true;
            recipientFailure = null;
          } else {
            recipientFailure ??= fallback.reason;
          }
        }
      }

      if (deliveredAny) {
        emailsSent++;
      } else {
        emailErrors.push(
          `${player.member_email}: ${recipientFailure ?? "no delivery channel"}`,
        );
      }
    }

    // The matchday was already stamped notified by the up-front claim, so
    // there's nothing more to persist here. Partial delivery failures stay
    // recorded as notified (the batch is one-shot) and are surfaced to the
    // captain via emailErrors; failed addresses are chased via the charges
    // admin rather than a re-send.
    return { success: true, emailsSent, emailErrors };
  };
}

/**
 * Player-initiated dropout from a matchday they were selected for.
 *
 * Self-service counterpart to the captain's finish flow: instead of an
 * official marking someone `dropped_out` at wrap-up, the player (or a
 * parent acting for their dependent) sets their own row to `withdrawn`
 * before the game. Reuses the existing `withdrawn` status - no new
 * status to distinguish player- vs admin-initiated (#393 decision §4).
 *
 * Authorisation is by ownership, not role: the matchday_player row must
 * belong to the signed-in member, or to one of their dependents (a
 * parent dropping a junior out). Cutoff is "before the game" - we don't
 * store a precise start time, so the gate is that the match hasn't
 * happened yet (match_date today or later) and the matchday is still
 * live (pending/confirmed). Withdrawal is final: the row leaves the
 * "selected/playing" set, so the upcoming-games card stops offering it
 * and re-adding is a captain action.
 *
 * The captain is notified best-effort (email and/or push per their
 * preference). A notification failure never rolls back the withdrawal -
 * the player has already dropped out regardless of whether the captain's
 * email bounced.
 */
export function withdrawFromMatch(
  db: Kysely<DB>,
  sendEmail: (email: {
    to: string;
    subject: string;
    html: string;
  }) => Promise<void>,
  sendPush: SendPush,
  config: { BASE_URL: string; MATCHDAY_URL?: string },
) {
  const fetchPrefs = getNotificationPreferencesByUserIds(db);
  const fetchPushSubs = listPushSubscriptionsForUsers(db);
  const pruneSubscription = deletePushSubscriptionByEndpoint(db);

  return async (
    email: string,
    matchdayPlayerId: string,
    log: FastifyBaseLogger,
  ) => {
    const member = await db
      .selectFrom("member")
      .where("email", "=", email)
      .select(["id"])
      .executeTakeFirst();
    if (!member) throwHttpError(403, "You can only drop out of your own games");

    const player = await db
      .selectFrom("matchday_player")
      .innerJoin("matchday", "matchday.id", "matchday_player.matchday_id")
      .leftJoin("dependent", "dependent.id", "matchday_player.dependent_id")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .where("matchday_player.id", "=", matchdayPlayerId)
      .select([
        "matchday_player.member_id as playerMemberId",
        "matchday_player.dependent_id as dependentId",
        "matchday_player.player_name as playerName",
        "matchday_player.status as playerStatus",
        "dependent.member_id as dependentParentId",
        "matchday.id as matchdayId",
        "matchday.status as matchdayStatus",
        "matchday.match_date as matchDate",
        "matchday.opposition as opposition",
        "matchday.play_cricket_team_id as teamId",
        "play_cricket_team.name as teamName",
      ])
      .executeTakeFirst();
    if (!player) throwHttpError(404, "Selection not found");

    // Ownership: the row is the member's own selection, or one of their
    // dependents' (parent acting on a junior's behalf).
    const ownsRow =
      player.playerMemberId === member.id ||
      (player.dependentId !== null && player.dependentParentId === member.id);
    if (!ownsRow) {
      throwHttpError(403, "You can only drop out of your own games");
    }

    if (
      player.matchdayStatus !== "pending" &&
      player.matchdayStatus !== "confirmed"
    ) {
      throwHttpError(400, "This game is no longer open for changes");
    }
    const todayIso = formatDate(new Date(), "yyyy-MM-dd");
    if (player.matchDate < todayIso) {
      throwHttpError(400, "This game has already taken place");
    }

    // Only a live selection can be withdrawn. Cheap read-side fast-path
    // so the common re-tap returns a clear error; the authoritative guard
    // is the conditional claim below.
    if (
      player.playerStatus !== "selected" &&
      player.playerStatus !== "playing"
    ) {
      throwHttpError(400, "You are not currently selected for this game");
    }

    // Claim the withdrawal under a matchday row lock so it serialises
    // against a concurrent cancel/finish. The status/date checks above are
    // a read-side fast-path, but they're TOCTOU: an official can close the
    // matchday between that read and this write. Locking the matchday row
    // (SELECT ... FOR UPDATE) and re-reading its status under the lock is
    // what closes the race - cancel/finish also touch this row, so whoever
    // takes the lock first wins and the loser sees the committed result. A
    // plain WHERE subquery would NOT do this: under READ COMMITTED it reads
    // the pre-close snapshot, so the withdraw and the cancel both commit
    // and a player ends up withdrawn (with captain/keeper flags stripped)
    // from a closed game.
    const outcome = await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom("matchday")
        .where("id", "=", player.matchdayId)
        .select(["status", "match_date"])
        .forUpdate()
        .executeTakeFirst();
      if (
        !current ||
        current.match_date < todayIso ||
        (current.status !== "pending" && current.status !== "confirmed")
      ) {
        return "closed" as const;
      }

      // Flip the status only while the selection is still live. Two
      // concurrent dropouts both queue on the matchday lock above, so the
      // loser sees the row already withdrawn here, updates zero rows, and
      // bails before notifying the captain a second time. Captain/keeper
      // flags are cleared so a withdrawn player leaves no orphaned role on
      // the team sheet.
      const claim = await trx
        .updateTable("matchday_player")
        .set({ status: "withdrawn", is_captain: false, is_wicketkeeper: false })
        .where("id", "=", matchdayPlayerId)
        .where("status", "in", ["selected", "playing"])
        .executeTakeFirst();
      return claim.numUpdatedRows === 0n
        ? ("not_selected" as const)
        : ("withdrawn" as const);
    });

    if (outcome === "closed") {
      throwHttpError(400, "This game is no longer open for changes");
    }
    if (outcome === "not_selected") {
      throwHttpError(400, "You are not currently selected for this game");
    }

    const notifyManagers = async (): Promise<void> => {
      // Everyone who manages this team should hear about a dropout so any
      // of them can line up a replacement: all assigned team officials,
      // the club-wide matchday_admin role holders, plus the captain
      // (added even if they aren't an assigned official).
      const officials = await db
        .selectFrom("team_official")
        .innerJoin("user", "user.id", "team_official.user_id")
        .where("team_official.play_cricket_team_id", "=", player.teamId)
        .select(["user.email as email", "user.name as name"])
        .execute();

      // Club-wide gameday admins. Narrow in SQL, then confirm exactly with
      // parseRoles so a substring match can't sneak in - and so the legacy
      // kitchen-sink `admin` role is deliberately NOT included here.
      const matchdayAdmins = (
        await db
          .selectFrom("user")
          .where("role", "like", "%matchday_admin%")
          .select(["email", "name", "role"])
          .execute()
      ).filter((u) => parseRoles(u.role).includes("matchday_admin"));

      const captain = await db
        .selectFrom("matchday_player")
        .innerJoin("member", "member.id", "matchday_player.member_id")
        .where("matchday_player.matchday_id", "=", player.matchdayId)
        .where("matchday_player.is_captain", "=", true)
        .select(["member.name as name", "member.email as email"])
        .executeTakeFirst();

      // Dedupe by lowercased email and drop the person who just dropped
      // out (an official/admin/captain shouldn't be told about their own
      // action). Recipients without a user account still get email-only.
      const actorEmail = email.toLowerCase();
      const recipientByEmail = new Map<
        string,
        { email: string; name: string }
      >();
      for (const r of [...officials, ...matchdayAdmins, captain]) {
        if (!r?.email) continue;
        const key = r.email.toLowerCase();
        if (key === actorEmail || recipientByEmail.has(key)) continue;
        recipientByEmail.set(key, { email: r.email, name: r.name ?? "there" });
      }
      const recipients = [...recipientByEmail.values()];
      if (recipients.length === 0) return;

      // Resolve user ids so each recipient's matchday_channel preference
      // and push subscriptions apply. Officials always have a user row;
      // a captain who never registered won't, and falls back to email.
      const userRows = await db
        .selectFrom("user")
        .where(
          "email",
          "in",
          recipients.map((r) => r.email.toLowerCase()),
        )
        .select(["id", "email"])
        .execute();
      const userIdByEmail = new Map(
        userRows.map((u) => [u.email.toLowerCase(), u.id]),
      );
      const userIds = userRows.map((u) => u.id);
      const [prefs, pushSubsByUser] = await Promise.all([
        fetchPrefs(userIds),
        fetchPushSubs(userIds),
      ]);

      const teamName = player.teamName ?? "your team";
      const teamSheetUrl = config.MATCHDAY_URL
        ? `${config.MATCHDAY_URL}/matchday/${player.matchdayId}`
        : `${config.BASE_URL}/matchday/${player.matchdayId}`;

      const sendOneEmail = async (recipient: {
        email: string;
        name: string;
      }): Promise<boolean> => {
        try {
          const { render } = await import("react-email");
          const { PlayerWithdrawal } = await import("@percy-main/email");
          const element = PlayerWithdrawal.component({
            imageBaseUrl: `${config.BASE_URL}/images`,
            recipientName: recipient.name,
            playerName: player.playerName,
            teamName,
            opposition: player.opposition,
            matchDate: formatDate(new Date(player.matchDate), "dd/MM/yyyy"),
            teamSheetUrl,
          });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
          const html = await render(element as any);
          await sendEmail({
            to: recipient.email,
            subject: PlayerWithdrawal.subject,
            html,
          });
          return true;
        } catch (err) {
          log.error(
            {
              err,
              matchdayId: player.matchdayId,
              recipientEmail: recipient.email,
              channel: "email",
            },
            "withdrawal_notification_failed",
          );
          return false;
        }
      };

      for (const recipient of recipients) {
        const userId = userIdByEmail.get(recipient.email.toLowerCase());
        const channel: MatchdayChannel = userId
          ? (prefs.get(userId) ?? DEFAULT_MATCHDAY_CHANNEL)
          : "email";
        const wantsEmail = channel === "email" || channel === "both";
        const wantsPush = channel === "push" || channel === "both";
        const subscriptions = userId ? (pushSubsByUser.get(userId) ?? []) : [];
        const pushAvailable = wantsPush && subscriptions.length > 0;

        let deliveredAny = false;

        // Push-only recipients with no live subscription fall back to
        // email so a dropout is never silently missed.
        if (wantsEmail || (wantsPush && !pushAvailable)) {
          if (await sendOneEmail(recipient)) deliveredAny = true;
        }

        if (pushAvailable) {
          const payload = {
            title: "Player dropout",
            body: `${player.playerName} dropped out of ${teamName} vs ${player.opposition}`,
            url: teamSheetUrl,
            tag: `withdrawal:${player.matchdayId}`,
          };
          let pushDelivered = false;
          let allGone = true;
          for (const sub of subscriptions) {
            const result = await sendPush(sub, payload);
            if (result.ok) {
              deliveredAny = true;
              pushDelivered = true;
              allGone = false;
            } else if (result.gone) {
              await pruneSubscription(result.endpoint);
              log.info(
                { matchdayId: player.matchdayId, endpoint: result.endpoint },
                "push_subscription_gone_pruned",
              );
            } else {
              allGone = false;
              log.warn(
                {
                  matchdayId: player.matchdayId,
                  endpoint: result.endpoint,
                  reason: result.reason,
                  channel: "push",
                },
                "withdrawal_notification_failed",
              );
            }
          }
          if (!wantsEmail && !pushDelivered && allGone) {
            if (await sendOneEmail(recipient)) deliveredAny = true;
          }
        }

        if (!deliveredAny) {
          log.warn(
            { matchdayId: player.matchdayId, recipientEmail: recipient.email },
            "withdrawal_notification_undelivered",
          );
        }
      }
    };

    // Best-effort: the withdrawal stands even if notifying the team's
    // managers throws (e.g. a transient DB or render error).
    try {
      await notifyManagers();
    } catch (err) {
      log.error(
        { err, matchdayPlayerId, matchdayId: player.matchdayId },
        "withdrawal_notification_failed",
      );
    }

    return { success: true };
  };
}

// ── Expense approval workflow services ──

export function submitExpenseClaim(db: Kysely<DB>, s3: S3Uploader) {
  return async (
    userId: string,
    role: string,
    data: SubmitExpense & { matchId: string },
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", data.matchId)
      .select(["id", "play_cricket_team_id", "status"])
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    if (matchday.status !== "confirmed") {
      throwHttpError(
        400,
        matchday.status === "pending"
          ? "Cannot submit expenses for a pending matchday. Confirm the team first."
          : "Cannot submit expenses for a finished matchday.",
      );
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const receiptImageUrl = await uploadReceiptImage(data.receiptImage, id, s3);

    await db
      .insertInto("matchday_expense")
      .values({
        id,
        matchday_id: data.matchId,
        expense_type: data.type,
        description: data.description ?? null,
        amount_pence: data.amountPence,
        created_by: userId,
        created_at: now,
        receipt_image_url: receiptImageUrl,
        status: "submitted",
        submitted_at: now,
      })
      .execute();

    return { expenseId: id };
  };
}

/**
 * Team-scope guard for expense mutations addressed by expense ID.
 *
 * Club-wide matchday managers pass straight through. A scoped official only
 * passes if the expense hangs off a matchday for one of their assigned teams;
 * otherwise this throws the same 404 the service raises for an expense that
 * doesn't exist, so an out-of-scope ID is indistinguishable from a bad one
 * (same rule as getMatch's "not found or access denied").
 */
async function assertExpenseInScope(
  db: Kysely<DB>,
  userId: string,
  role: string,
  expenseId: string,
): Promise<void> {
  if (hasClubWideAccess(role, "matchday", "manage")) return;

  const access = await db
    .selectFrom("matchday_expense")
    .innerJoin("matchday", "matchday.id", "matchday_expense.matchday_id")
    .innerJoin(
      "team_official",
      "team_official.play_cricket_team_id",
      "matchday.play_cricket_team_id",
    )
    .where("matchday_expense.id", "=", expenseId)
    .where("team_official.user_id", "=", userId)
    .select("matchday_expense.id")
    .executeTakeFirst();

  if (!access) throwHttpError(404, "Expense not found");
}

export function approveExpense(db: Kysely<DB>) {
  return async (adminUserId: string, role: string, expenseId: string) => {
    await assertExpenseInScope(db, adminUserId, role, expenseId);

    const expense = await db
      .selectFrom("matchday_expense")
      .where("id", "=", expenseId)
      .select(["id", "status"])
      .executeTakeFirst();

    if (!expense) throwHttpError(404, "Expense not found");

    if (expense.status !== "submitted") {
      throwHttpError(
        400,
        `Cannot approve an expense with status '${expense.status}'. Only submitted expenses can be approved.`,
      );
    }

    await db
      .updateTable("matchday_expense")
      .set({
        status: "approved",
        approved_by: adminUserId,
        approved_at: new Date().toISOString(),
      })
      .where("id", "=", expenseId)
      .execute();

    return { success: true };
  };
}

export function rejectExpense(db: Kysely<DB>) {
  return async (
    adminUserId: string,
    role: string,
    expenseId: string,
    data: RejectExpense,
  ) => {
    await assertExpenseInScope(db, adminUserId, role, expenseId);

    const expense = await db
      .selectFrom("matchday_expense")
      .where("id", "=", expenseId)
      .select(["id", "status"])
      .executeTakeFirst();

    if (!expense) throwHttpError(404, "Expense not found");

    if (expense.status !== "submitted") {
      throwHttpError(
        400,
        `Cannot reject an expense with status '${expense.status}'. Only submitted expenses can be rejected.`,
      );
    }

    await db
      .updateTable("matchday_expense")
      .set({
        status: "rejected",
        rejected_reason: data.reason,
      })
      .where("id", "=", expenseId)
      .execute();

    return { success: true };
  };
}

/**
 * Paying a claim out is a treasurer action, not a per-team one, so there is no
 * team-scope branch here: the route requires finance:manage and team-scoped
 * officials never reach this service.
 */
export function markExpenseReimbursed(db: Kysely<DB>) {
  return async (adminUserId: string, expenseId: string) => {
    const expense = await db
      .selectFrom("matchday_expense")
      .where("id", "=", expenseId)
      .select(["id", "status"])
      .executeTakeFirst();

    if (!expense) throwHttpError(404, "Expense not found");

    if (expense.status !== "approved") {
      throwHttpError(
        400,
        `Cannot reimburse an expense with status '${expense.status}'. Only approved expenses can be reimbursed.`,
      );
    }

    await db
      .updateTable("matchday_expense")
      .set({
        status: "reimbursed",
        reimbursed_by: adminUserId,
        reimbursed_at: new Date().toISOString(),
      })
      .where("id", "=", expenseId)
      .execute();

    return { success: true };
  };
}

export function listPendingExpenses(db: Kysely<DB>) {
  return async (userId: string, role: string, params: ListPendingExpenses) => {
    // Team-scoped officials see only expenses raised on their own teams'
    // matchdays. No assignments means no visible expenses - short-circuit
    // rather than emit an empty IN list.
    let assignedTeamIds: string[] | null = null;
    if (!hasClubWideAccess(role, "matchday", "manage")) {
      assignedTeamIds = await getAssignedTeamIds(db, userId);
      if (assignedTeamIds.length === 0) return { items: [] };
    }

    let query = db
      .selectFrom("matchday_expense")
      .innerJoin("matchday", "matchday.id", "matchday_expense.matchday_id")
      .innerJoin("user", "user.id", "matchday_expense.created_by")
      .select([
        "matchday_expense.id",
        "matchday_expense.matchday_id",
        "matchday_expense.expense_type",
        "matchday_expense.description",
        "matchday_expense.amount_pence",
        "matchday_expense.receipt_image_url",
        "matchday_expense.status",
        "matchday_expense.created_at",
        "matchday_expense.submitted_at",
        "matchday_expense.approved_at",
        "matchday_expense.rejected_reason",
        "matchday.opposition",
        "matchday.match_date",
        "matchday.play_cricket_team_id",
        "user.name as created_by_name",
      ]);

    if (params.status) {
      query = query.where("matchday_expense.status", "=", params.status);
    } else {
      query = query.where("matchday_expense.status", "in", [
        "submitted",
        "approved",
      ]);
    }

    if (assignedTeamIds) {
      query = query.where(
        "matchday.play_cricket_team_id",
        "in",
        assignedTeamIds,
      );
    }

    if (params.teamId) {
      query = query.where("matchday.play_cricket_team_id", "=", params.teamId);
    }

    const items = await query
      .orderBy("matchday_expense.submitted_at", "asc")
      .limit(params.limit)
      .offset(params.offset)
      .execute();

    return { items };
  };
}

export interface TeamNewsPlayer {
  playerName: string;
  sponsorName: string | null;
  isCaptain: boolean;
  isWicketkeeper: boolean;
}

export interface TeamNewsData {
  teamName: string;
  opposition: string;
  matchDate: string;
  matchTime: string | null;
  isHome: boolean;
  players: TeamNewsPlayer[];
  matchSponsor: { name: string; logoUrl: string | null } | null;
}

/**
 * Optional dependencies that let the service derive home/away + match
 * time from the upstream play-cricket fixture when the caller didn't
 * specify them. `apiClient` is the typed Play-Cricket client; `siteId`
 * is our Percy Main club id.
 *
 * Pass both `null` when play-cricket isn't configured (local dev
 * without the API token) - the service falls back to `isHome=true` and
 * no time. With apiClient set, derivation failures THROW instead of
 * silently defaulting: an away fixture rendered as home is a real bug
 * (it's how we got here), so a noisy failure beats a wrong image.
 */
export interface TeamNewsImageContext {
  apiClient: PlayCricketApiClient | null;
  siteId: string | null;
}

export function getTeamNewsData(db: Kysely<DB>, ctx: TeamNewsImageContext) {
  return async (
    userId: string,
    role: string,
    matchId: string,
    overrides: { isHome?: boolean; matchTime?: string },
  ): Promise<TeamNewsData> => {
    // Verify access (same pattern as getMatch)
    if (!hasClubWideAccess(role, "matchday", "view")) {
      const access = await db
        .selectFrom("matchday")
        .innerJoin(
          "team_official",
          "team_official.play_cricket_team_id",
          "matchday.play_cricket_team_id",
        )
        .where("matchday.id", "=", matchId)
        .where("team_official.user_id", "=", userId)
        .select("matchday.id")
        .executeTakeFirst();

      if (!access) {
        throwHttpError(404, "Match not found or access denied");
      }
    }

    const match = await db
      .selectFrom("matchday")
      .where("id", "=", matchId)
      .selectAll()
      .executeTakeFirst();

    if (!match) {
      throwHttpError(404, "Match not found");
    }

    const team = await db
      .selectFrom("play_cricket_team")
      .where("id", "=", match.play_cricket_team_id)
      .select(["id", "name"])
      .executeTakeFirst();

    // Fetch players with their member slug for sponsor lookup
    // Only active selections belong on the published team graphic.
    // Excludes `replaced` as well as pre-match `withdrawn` dropouts and
    // post-match `dropped_out` / `no_show`.
    const players = await db
      .selectFrom("matchday_player")
      .where("matchday_id", "=", matchId)
      .where("matchday_player.status", "in", ["selected", "playing"])
      .leftJoin("member", "member.id", "matchday_player.member_id")
      .select([
        "matchday_player.player_name",
        "matchday_player.is_captain",
        "matchday_player.is_wicketkeeper",
        "member.slug",
      ])
      .orderBy("matchday_player.created_at", "asc")
      .execute();

    // Batch-fetch player sponsorships for all slugs
    const currentYear = new Date().getFullYear();
    const slugs = players
      .map((p) => p.slug)
      .filter((s): s is string => s !== null);

    const playerSponsorships =
      slugs.length > 0
        ? await db
            .selectFrom("player_sponsorship")
            .where("slug", "in", slugs)
            .where("season", "=", currentYear)
            .where("approved", "=", true)
            .where("paid_at", "is not", null)
            .select(["slug", "display_name", "sponsor_name"])
            .execute()
        : [];

    const sponsorBySlug = new Map(
      playerSponsorships.map((s) => [s.slug, s.display_name ?? s.sponsor_name]),
    );

    // Fetch game sponsorship
    let matchSponsor: TeamNewsData["matchSponsor"] = null;
    if (match.play_cricket_match_id) {
      const sponsorship = await db
        .selectFrom("game_sponsorship")
        .where("game_id", "=", match.play_cricket_match_id)
        .where("approved", "=", true)
        .where("paid_at", "is not", null)
        .select(["display_name", "sponsor_name", "sponsor_logo_url"])
        .executeTakeFirst();

      if (sponsorship) {
        matchSponsor = {
          name: sponsorship.display_name ?? sponsorship.sponsor_name,
          logoUrl: sponsorship.sponsor_logo_url,
        };
      }
    }

    // Resolve isHome + matchTime. Honour explicit caller overrides,
    // then the matchday's own columns (populated for custom fixtures
    // created without a Play-Cricket match); otherwise look the fixture
    // up via the play-cricket matches-summary endpoint (the
    // match-detail endpoint's schema drops match_time - both fields
    // live on the summary row). If play-cricket is wired and the
    // lookup fails, propagate the error: a wrong home/away image is
    // exactly the bug we're trying to stop shipping.
    let { isHome, matchTime } = overrides;
    isHome ??= match.is_home ?? undefined;
    matchTime ??= match.match_time ?? undefined;
    if (
      (isHome === undefined || matchTime === undefined) &&
      match.play_cricket_match_id &&
      ctx.apiClient &&
      ctx.siteId
    ) {
      const season = Number(match.match_date.slice(0, 4));
      const summary = await ctx.apiClient.getMatchesSummary(season);
      const row = summary.matches.find(
        (m) => m.id.toString() === match.play_cricket_match_id,
      );
      if (!row) {
        throwHttpError(
          502,
          `play-cricket has no fixture with id ${match.play_cricket_match_id} in season ${season}`,
        );
      }
      isHome ??= row.home_club_id === ctx.siteId;
      matchTime ??= row.match_time;
    }

    return {
      teamName: team?.name ? `Percy Main ${team.name}` : "Percy Main",
      opposition: match.opposition,
      matchDate: match.match_date,
      matchTime: matchTime ?? null,
      isHome: isHome ?? true,
      players: players.map((p) => ({
        playerName: p.player_name,
        sponsorName: p.slug ? (sponsorBySlug.get(p.slug) ?? null) : null,
        isCaptain: p.is_captain,
        isWicketkeeper: p.is_wicketkeeper,
      })),
      matchSponsor,
    };
  };
}
