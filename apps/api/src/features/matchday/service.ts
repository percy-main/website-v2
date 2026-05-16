import type { DB } from "@percy-main/db";
import { hasClubWideAccess } from "@percy-main/shared/auth/permissions";
import {
  format as formatDate,
  isBefore,
  parse,
  startOfDay,
  subDays,
} from "date-fns";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { S3Uploader } from "../../lib/s3-upload.ts";
import { applyReliefIfAny } from "../financial-relief/apply-relief.ts";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
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

/**
 * Returns the play_cricket_team IDs the user is allowed to access.
 * Admins get all teams; officials get their assigned teams.
 */
async function getAccessibleTeamIds(
  db: Kysely<DB>,
  userId: string,
  role: string,
): Promise<string[]> {
  if (hasClubWideAccess(role, "matchday", "view")) {
    const allTeams = await db
      .selectFrom("play_cricket_team")
      .select("id")
      .execute();
    return allTeams.map((t) => t.id).filter((id): id is string => id !== null);
  }

  const assignments = await db
    .selectFrom("team_official")
    .where("user_id", "=", userId)
    .select("play_cricket_team_id")
    .execute();

  return assignments.map((a) => a.play_cricket_team_id);
}

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
 * Same access guardrails as the public-facing matchday hub on the main
 * site — only matchdays in `confirmed` or `finished` status are visible
 * (pending teams aren't picked yet), and the response strips every
 * sensitive surface (no expenses, no charge IDs, no amounts, no audit
 * timestamps).
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
        "play_cricket_team.name as team_name",
      ])
      .executeTakeFirst();
    if (!match) {
      throwHttpError(404, "Matchday not found");
    }
    // Pending teams aren't picked yet — don't leak the picker state.
    if (match.status === "pending") {
      throwHttpError(404, "Team not yet announced");
    }
    // Cancelled matchdays: the cancel reason on the parent record is a
    // free-text field captured from officials and may carry PII. The
    // public projection doesn't expose the reason today, but skip the
    // squad reveal too — a cancelled fixture has no team sheet to show.
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
      // Home/away, ground, match time, and score summary live on the
      // joined play_cricket_match record, which this service doesn't
      // load yet. Phase 2.1 cleanup if we need them. For now: null —
      // the schema is `.nullable()` so callers know to render the
      // field as "—" or hide it rather than treat `false` as truth.
      startTime: null as string | null,
      teamName: match.team_name,
      opposition: match.opposition,
      ground: null as string | null,
      competition: match.competition_type,
      away: null as boolean | null,
      status: match.status as "confirmed" | "finished",
      result: match.result_type,
      scoreSummary: null as string | null,
      squad,
      dropouts,
    };
  };
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

    const id = crypto.randomUUID();
    await db
      .insertInto("matchday")
      .values({
        id,
        play_cricket_team_id: data.teamId,
        match_date: data.matchDate,
        opposition: data.opposition,
        competition_type: data.competitionType ?? null,
        play_cricket_match_id: data.playCricketMatchId ?? null,
        status: "pending",
        created_by: userId,
      })
      .execute();

    return { id };
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

export function finishMatch(
  db: Kysely<DB>,
  sendEmail: (email: {
    to: string;
    subject: string;
    html: string;
  }) => Promise<void>,
  config: { BASE_URL: string },
) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    data: FinishMatch,
    log: FastifyBaseLogger,
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
      const missing: string[] = [];
      for (const p of players) {
        const willPlay =
          (statusOverrides.get(p.matchdayPlayerId) ?? p.current_status) ===
          "playing";
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

    for (const { matchdayPlayerId, status } of playerStatuses) {
      await db
        .updateTable("matchday_player")
        .set({ status })
        .where("id", "=", matchdayPlayerId)
        .where("matchday_id", "=", matchdayId)
        .execute();
    }

    await db
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

    if (isFirstFinish) {
      // Submit all draft expenses for treasurer review
      await db
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
      const uncharged = await db
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

      if (uncharged.length > 0) {
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

        const applyRelief = applyReliefIfAny(db);
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

          const rate = findFeeRate(
            feeRates,
            matchday.play_cricket_team_id,
            matchday.competition_type,
            category,
          );
          const overrideAmount = overrides.get(player.matchdayPlayerId);
          const amountPence = overrideAmount ?? rate?.amount_pence ?? 0;

          if (amountPence === 0) continue;

          const chargeId = crypto.randomUUID();
          await db
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

          await db
            .updateTable("matchday_player")
            .set({ charge_id: chargeId })
            .where("id", "=", player.matchdayPlayerId)
            .execute();

          if (chargeDependentId) {
            await db
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
        }
      }

      // Send notification emails for unpaid charges. Join `member` via
      // `charge.member_id` (not `matchday_player.member_id`) so junior
      // donations — which sit on the parent's member row — also get a
      // notification.
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

      let emailsSent = 0;
      const emailErrors: string[] = [];
      for (const player of unpaidPlayers) {
        if (!player.member_email) continue;

        try {
          const amountFormatted = currencyFormatter.format(
            player.amount_pence / 100,
          );

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
            to: player.member_email,
            subject: ChargeNotification.subject,
            html,
          });
          emailsSent++;
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Unknown email error";
          emailErrors.push(`${player.member_email}: ${msg}`);
          log.error(
            { err, recipientEmail: player.member_email, matchdayId },
            "matchday_charge_notification_failed",
          );
        }
      }

      return { success: true, emailsSent, emailErrors };
    }

    // Result resubmission — just update the result, no charges/emails
    return { success: true, emailsSent: 0, emailErrors: [] };
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

export function approveExpense(db: Kysely<DB>) {
  return async (adminUserId: string, expenseId: string) => {
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
    expenseId: string,
    data: RejectExpense,
  ) => {
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
  return async (params: ListPendingExpenses) => {
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

export function getTeamNewsData(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchId: string,
    isHome: boolean,
    matchTime: string | undefined,
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
    const players = await db
      .selectFrom("matchday_player")
      .where("matchday_id", "=", matchId)
      .where("matchday_player.status", "!=", "replaced")
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

    return {
      teamName: team?.name ? `Percy Main ${team.name}` : "Percy Main",
      opposition: match.opposition,
      matchDate: match.match_date,
      matchTime: matchTime ?? null,
      isHome,
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
