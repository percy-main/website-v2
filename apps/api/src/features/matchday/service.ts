import type { DB } from "@percy-main/db";
import { format as formatDate, isBefore, parse, startOfDay, subDays } from "date-fns";
import type { Kysely } from "kysely";
import type { PlayCricketApiClient } from "../play-cricket/api-client.js";
import type {
  AddPlayer,
  ConfirmTeam,
  CreateMatchday,
  ListMatches,
  MarkPaid,
  RecordExpense,
  SearchMembers,
  UpdateExpense,
} from "./schemas.js";

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
  if (role === "admin") {
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
    if (role !== "admin") {
      query = query
        .innerJoin(
          "team_official",
          "team_official.play_cricket_team_id",
          "matchday.play_cricket_team_id",
        )
        .where("team_official.user_id", "=", userId) as typeof query;
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
    if (role !== "admin") {
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
        .leftJoin("charge", "charge.id", "matchday_player.charge_id")
        .select([
          "matchday_player.id",
          "matchday_player.member_id",
          "matchday_player.player_name",
          "matchday_player.status",
          "matchday_player.replaced_by_matchday_player_id",
          "matchday_player.charge_id",
          "matchday_player.created_at",
          "member.member_category",
          "charge.paid_at as chargePaidAt",
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

    return { matchday: match, team: team ?? null, players, expenses };
  };
}

export function recordExpense(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    data: RecordExpense & { matchId: string },
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
          ? "Cannot add expenses to a pending matchday. Confirm the team first."
          : "Cannot add expenses to a finished matchday.",
      );
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    // TODO: Upload receipt image to S3 when infrastructure is live.
    // For now, store the data URL directly in the DB column.
    let receiptImageUrl: string | null = null;
    if (data.receiptImage) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(
        data.receiptImage,
      );
      if (!match) throwHttpError(400, "Invalid receipt image format");

      const imageBytes = Buffer.from(match[2], "base64");
      if (imageBytes.byteLength > 500_000) {
        throwHttpError(400, "Receipt image is too large. Maximum size is 500KB");
      }

      // TODO: Replace with S3 upload once infra is live:
      //   const s3Url = await uploadReceiptToS3(imageBytes, match[1]);
      //   receiptImageUrl = s3Url;
      receiptImageUrl = data.receiptImage;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

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
  return async (userId: string, data: UpdateExpense) => {
    const fieldsToUpdate: Record<string, unknown> = {};
    if (data.type !== undefined) fieldsToUpdate.expense_type = data.type;
    if (data.description !== undefined)
      fieldsToUpdate.description = data.description;
    if (data.amountPence !== undefined)
      fieldsToUpdate.amount_pence = data.amountPence;

    if (Object.keys(fieldsToUpdate).length > 0) {
      await db
        .updateTable("matchday_expense")
        .set(fieldsToUpdate)
        .where("id", "=", data.expenseId)
        .execute();
    }

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

    return teams.filter(
      (t): t is typeof t & { id: string } => t.id !== null,
    );
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

    // Check which matches already have a matchday record
    const existingMatchdays = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", teamId)
      .selectAll()
      .execute();

    const matchdayByDate = new Map(
      existingMatchdays.map((md) => [md.match_date, md]),
    );

    return upcoming.map((m) => {
      const isoDate = parse(m.matchDate, "dd/MM/yyyy", new Date())
        .toISOString()
        .split("T")[0];
      const existingMatchday = matchdayByDate.get(isoDate);

      return {
        ...m,
        matchdayId: existingMatchday?.id ?? null,
        matchdayStatus: existingMatchday?.status ?? null,
      };
    });
  };
}

export function createMatchday(db: Kysely<DB>) {
  return async (userId: string, role: string, data: CreateMatchday) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(data.teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    // Check no existing matchday for this team + date
    const existing = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", data.teamId)
      .where("match_date", "=", data.matchDate)
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

    const members = await db
      .selectFrom("member")
      .where("name", "ilike", term)
      .select(["id", "name", "email", "member_category"])
      .orderBy("name", "asc")
      .limit(20)
      .execute();

    return members;
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

    if (matchday.status === "finished") {
      throwHttpError(400, "Cannot add players to a finished matchday");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
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

    const id = crypto.randomUUID();

    await db.transaction().execute(async (trx) => {
      let finalMemberId = data.memberId ?? null;

      // Create guest member record for ad-hoc players
      if (!data.memberId && data.playerName.trim()) {
        finalMemberId = crypto.randomUUID();
        await trx
          .insertInto("member")
          .values({
            id: finalMemberId,
            name: data.playerName,
            email: "",
            title: "",
            address: "",
            postcode: "",
            dob: "",
            telephone: "",
            emergency_contact_name: "",
            emergency_contact_telephone: "",
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

    if (player.matchday_status === "finished") {
      throwHttpError(400, "Cannot remove players from a finished matchday");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(player.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    await db
      .deleteFrom("matchday_player")
      .where("id", "=", playerId)
      .execute();

    return { success: true };
  };
}

export function confirmTeam(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    matchdayId: string,
    data: ConfirmTeam,
  ) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .selectAll()
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    if (matchday.status !== "pending") {
      throwHttpError(400, "Matchday has already been confirmed");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    // Update matchday status
    await db
      .updateTable("matchday")
      .set({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by: userId,
      })
      .where("id", "=", matchdayId)
      .execute();

    // Validate all player IDs belong to this matchday
    const playerIds = data.playerStatuses.map((ps) => ps.matchdayPlayerId);
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

    // Update player statuses
    for (const { matchdayPlayerId, status } of data.playerStatuses) {
      await db
        .updateTable("matchday_player")
        .set({ status })
        .where("id", "=", matchdayPlayerId)
        .where("matchday_id", "=", matchdayId)
        .execute();
    }

    // Generate match fees for "playing" players
    const playingPlayers = await db
      .selectFrom("matchday_player")
      .leftJoin("member", "member.id", "matchday_player.member_id")
      .where("matchday_player.matchday_id", "=", matchdayId)
      .where("matchday_player.status", "=", "playing")
      .select([
        "matchday_player.id as matchdayPlayerId",
        "matchday_player.member_id",
        "matchday_player.player_name",
        "member.member_category",
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

    for (const player of playingPlayers) {
      if (!player.member_id) continue;

      const category = player.member_category ?? "guest";
      if (category === "bursary") continue;

      const rate = findFeeRate(
        feeRates,
        matchday.play_cricket_team_id,
        matchday.competition_type,
        category,
      );

      if (!rate || rate.amount_pence === 0) continue;

      const chargeId = crypto.randomUUID();
      await db
        .insertInto("charge")
        .values({
          id: chargeId,
          member_id: player.member_id,
          description: `Match fee - ${matchday.opposition} (${formatDate(new Date(matchday.match_date), "dd/MM/yyyy")})`,
          amount_pence: rate.amount_pence,
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
    }

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
      throwHttpError(400, "No match fee charge found for this player");
    }

    await db
      .updateTable("charge")
      .set({
        paid_at: new Date().toISOString(),
        payment_method: data.paymentMethod,
      })
      .where("id", "=", player.charge_id)
      .where("paid_at", "is", null)
      .execute();

    return { success: true };
  };
}

export function finishMatch(
  db: Kysely<DB>,
  sendEmail: (email: { to: string; subject: string; html: string }) => Promise<void>,
  config: { BASE_URL: string },
) {
  return async (userId: string, role: string, matchdayId: string) => {
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", matchdayId)
      .selectAll()
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    if (matchday.status !== "confirmed") {
      throwHttpError(400, "Can only finish a confirmed matchday");
    }

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(matchday.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this matchday");
    }

    // Set matchday to finished
    await db
      .updateTable("matchday")
      .set({
        status: "finished",
        finished_at: new Date().toISOString(),
        finished_by: userId,
      })
      .where("id", "=", matchdayId)
      .execute();

    // Create charges for any playing players who don't have one yet
    const uncharged = await db
      .selectFrom("matchday_player")
      .leftJoin("member", "member.id", "matchday_player.member_id")
      .where("matchday_player.matchday_id", "=", matchdayId)
      .where("matchday_player.status", "=", "playing")
      .where("matchday_player.charge_id", "is", null)
      .select([
        "matchday_player.id as matchdayPlayerId",
        "matchday_player.member_id",
        "matchday_player.player_name",
        "member.member_category",
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

      for (const player of uncharged) {
        if (!player.member_id) continue;
        const category = player.member_category ?? "guest";
        if (category === "bursary") continue;

        const rate = findFeeRate(
          feeRates,
          matchday.play_cricket_team_id,
          matchday.competition_type,
          category,
        );

        if (!rate || rate.amount_pence === 0) continue;

        const chargeId = crypto.randomUUID();
        await db
          .insertInto("charge")
          .values({
            id: chargeId,
            member_id: player.member_id,
            description: `Match fee - ${matchday.opposition} (${formatDate(new Date(matchday.match_date), "dd/MM/yyyy")})`,
            amount_pence: rate.amount_pence,
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
      }
    }

    // Send notification emails for unpaid charges
    const unpaidPlayers = await db
      .selectFrom("matchday_player")
      .innerJoin("charge", "charge.id", "matchday_player.charge_id")
      .innerJoin("member", "member.id", "matchday_player.member_id")
      .where("matchday_player.matchday_id", "=", matchdayId)
      .where("charge.paid_at", "is", null)
      .where("charge.deleted_at", "is", null)
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

    const { render } = await import("@react-email/render");
    const { ChargeNotification } = await import("@percy-main/email");

    let emailsSent = 0;
    for (const player of unpaidPlayers) {
      if (!player.member_email) continue;

      const amountFormatted = currencyFormatter.format(
        player.amount_pence / 100,
      );

      const element = ChargeNotification.component({
        imageBaseUrl: `${config.BASE_URL}/images`,
        name: player.member_name ?? "Member",
        description: player.charge_description,
        amount: amountFormatted,
        chargeDate: formatDate(
          new Date(player.charge_date),
          "dd/MM/yyyy",
        ),
        loginUrl: `${config.BASE_URL}/auth/login`,
      });

      await sendEmail({
        to: player.member_email,
        subject: ChargeNotification.subject,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        html: await render(element as any),
      });
      emailsSent++;
    }

    return { success: true, emailsSent };
  };
}
