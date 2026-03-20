import type { DB } from "@percy-main/db";
import { parse } from "date-fns";
import type { Kysely } from "kysely";
import type { PlayCricketApiClient } from "../play-cricket/api-client.ts";
import type {
  AssignPlayer,
  CreateRequest,
  DeclareAvailability,
  SetAvailabilityForMember,
  UnassignPlayer,
} from "./schemas.ts";

// ── Types ──

interface PlayCricketFixture {
  matchId: string;
  matchDate: string;
  opposition: string;
  teamId: string;
  teamName: string;
  isHome: boolean;
  competitionType: string | null;
}

// ── Helpers ──

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

/**
 * Fetch Play Cricket fixtures for all senior teams in a date window.
 */
async function fetchFixturesInWindow(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient,
  siteId: string,
  accessibleTeamIds: string[],
  startDate: string,
  endDate: string,
): Promise<PlayCricketFixture[]> {
  const seniorTeams = await db
    .selectFrom("play_cricket_team")
    .where("id", "in", accessibleTeamIds)
    .where("is_junior", "=", false)
    .select(["id", "name"])
    .execute();

  const seniorTeamIds = new Set(seniorTeams.map((t) => t.id));
  const teamNameById = new Map(seniorTeams.map((t) => [t.id, t.name]));

  if (seniorTeamIds.size === 0) return [];

  const now = new Date();
  const currentYear = now.getFullYear();
  const seasons =
    now.getMonth() < 3 ? [currentYear - 1, currentYear] : [currentYear];
  const summaries = await Promise.all(
    seasons.map((season) => playCricketApi.getMatchesSummary(season)),
  );
  const allMatches = summaries.flatMap((s) => s.matches);

  const startDateObj = parse(startDate, "yyyy-MM-dd", new Date());
  const endDateObj = parse(endDate, "yyyy-MM-dd", new Date());

  const fixtures: PlayCricketFixture[] = [];

  for (const m of allMatches) {
    const isHome =
      m.home_club_id === siteId && seniorTeamIds.has(m.home_team_id);
    const isAway =
      m.away_club_id === siteId && seniorTeamIds.has(m.away_team_id);
    if (!isHome && !isAway) continue;

    const matchDate = parse(m.match_date, "dd/MM/yyyy", new Date());
    if (matchDate < startDateObj || matchDate > endDateObj) continue;

    const teamId = isHome ? m.home_team_id : m.away_team_id;
    // Use date-fns format to avoid UTC timezone shift from toISOString()
    const isoDate = `${matchDate.getFullYear()}-${String(matchDate.getMonth() + 1).padStart(2, "0")}-${String(matchDate.getDate()).padStart(2, "0")}`;

    fixtures.push({
      matchId: m.id.toString(),
      matchDate: isoDate,
      opposition: isHome
        ? `${m.away_club_name} ${m.away_team_name}`
        : `${m.home_club_name} ${m.home_team_name}`,
      teamId,
      teamName: teamNameById.get(teamId) ?? teamId,
      isHome,
      competitionType: m.competition_type ?? null,
    });
  }

  return fixtures.sort((a, b) => a.matchDate.localeCompare(b.matchDate));
}

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

// ── Request services (official) ──

/**
 * Create an availability request for a date window.
 * Fetches fixtures from Play Cricket for all accessible senior teams,
 * creates availability_date records for each unique game date.
 */
export function createRequest(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient | null,
  siteId: string,
) {
  return async (userId: string, role: string, data: CreateRequest) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (accessibleIds.length === 0) {
      throwHttpError(403, "You do not have access to any teams");
    }

    if (data.startDate > data.endDate) {
      throwHttpError(400, "Start date must be before end date");
    }

    // Check for overlap with existing requests
    const overlapping = await db
      .selectFrom("availability_request")
      .where("start_date", "<=", data.endDate)
      .where("end_date", ">=", data.startDate)
      .select("id")
      .executeTakeFirst();

    if (overlapping) {
      throwHttpError(
        409,
        "This date range overlaps with an existing availability request",
      );
    }

    const requestId = crypto.randomUUID();

    // Fetch fixtures from Play Cricket
    let fixtures: PlayCricketFixture[] = [];
    if (playCricketApi) {
      fixtures = await fetchFixturesInWindow(
        db,
        playCricketApi,
        siteId,
        accessibleIds,
        data.startDate,
        data.endDate,
      );
    }

    // Create the request
    await db
      .insertInto("availability_request")
      .values({
        id: requestId,
        start_date: data.startDate,
        end_date: data.endDate,
        created_by: userId,
      })
      .execute();

    // Create availability_date records for each unique (team, date) pair
    const seen = new Set<string>();
    for (const fixture of fixtures) {
      const key = `${fixture.teamId}:${fixture.matchDate}`;
      if (seen.has(key)) continue;
      seen.add(key);

      await db
        .insertInto("availability_date")
        .values({
          id: crypto.randomUUID(),
          availability_request_id: requestId,
          play_cricket_team_id: fixture.teamId,
          match_date: fixture.matchDate,
          created_by: userId,
        })
        .execute();
    }

    return { id: requestId, datesCreated: seen.size, fixtures };
  };
}

/**
 * List all availability requests with summary counts.
 */
export function listRequests(db: Kysely<DB>) {
  return async (userId: string, role: string) => {
    // Verify access
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (accessibleIds.length === 0) {
      throwHttpError(403, "You do not have access to any teams");
    }

    const requests = await db
      .selectFrom("availability_request")
      .selectAll()
      .orderBy("start_date", "desc")
      .execute();

    if (requests.length === 0) return [];

    const requestIds = requests.map((r) => r.id);

    // Get availability dates grouped by request
    const dates = await db
      .selectFrom("availability_date")
      .where("availability_request_id", "in", requestIds)
      .selectAll()
      .execute();

    const dateIds = dates.map((d) => d.id);

    // Get declaration counts per date
    let declarations: Array<{
      availability_date_id: string;
      status: string;
    }> = [];
    if (dateIds.length > 0) {
      declarations = await db
        .selectFrom("player_availability")
        .where("availability_date_id", "in", dateIds)
        .select(["availability_date_id", "status"])
        .execute();
    }

    // Get matchdays for dates in these requests
    const matchDates = [...new Set(dates.map((d) => d.match_date))];
    let matchdays: Array<{
      id: string;
      match_date: string;
      opposition: string;
      play_cricket_team_id: string;
    }> = [];
    if (matchDates.length > 0) {
      matchdays = await db
        .selectFrom("matchday")
        .where("match_date", "in", matchDates)
        .select(["id", "match_date", "opposition", "play_cricket_team_id"])
        .execute();
    }

    // Group
    const datesByRequest = new Map<string, typeof dates>();
    for (const d of dates) {
      if (!d.availability_request_id) continue;
      const arr = datesByRequest.get(d.availability_request_id) ?? [];
      arr.push(d);
      datesByRequest.set(d.availability_request_id, arr);
    }

    const declarationsByDateId = new Map<string, typeof declarations>();
    for (const d of declarations) {
      const arr = declarationsByDateId.get(d.availability_date_id) ?? [];
      arr.push(d);
      declarationsByDateId.set(d.availability_date_id, arr);
    }

    return requests.map((request) => {
      const reqDates = datesByRequest.get(request.id) ?? [];
      const uniqueMatchDates = [
        ...new Set(reqDates.map((d) => d.match_date)),
      ].sort();

      let totalAvailable = 0;
      let totalMaybe = 0;
      let totalUnavailable = 0;
      let totalResponses = 0;
      for (const d of reqDates) {
        const decls = declarationsByDateId.get(d.id) ?? [];
        for (const decl of decls) {
          totalResponses++;
          if (decl.status === "available") totalAvailable++;
          else if (decl.status === "maybe") totalMaybe++;
          else if (decl.status === "unavailable") totalUnavailable++;
        }
      }

      // Matchdays in the window
      const windowMatchdays = matchdays.filter(
        (m) =>
          m.match_date >= request.start_date &&
          m.match_date <= request.end_date,
      );

      return {
        ...request,
        gameDates: uniqueMatchDates,
        totalDates: reqDates.length,
        totalAvailable,
        totalMaybe,
        totalUnavailable,
        totalResponses,
        matchdays: windowMatchdays,
      };
    });
  };
}

/**
 * Get a single request with its dates, declarations, fixtures, and assignments.
 * Uses Play Cricket API for fixture details (matchday records may not exist yet).
 */
export function getRequest(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient | null,
  siteId: string,
) {
  return async (userId: string, role: string, requestId: string) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (accessibleIds.length === 0) {
      throwHttpError(403, "You do not have access to any teams");
    }

    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .selectAll()
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    // Get availability dates for this request
    const dates = await db
      .selectFrom("availability_date")
      .where("availability_request_id", "=", requestId)
      .selectAll()
      .orderBy("match_date", "asc")
      .execute();

    if (dates.length === 0) {
      return { ...request, dates: [] };
    }

    const dateIds = dates.map((d) => d.id);

    // Fetch Play Cricket fixtures in the request window
    let fixtures: PlayCricketFixture[] = [];
    if (playCricketApi) {
      fixtures = await fetchFixturesInWindow(
        db,
        playCricketApi,
        siteId,
        accessibleIds,
        request.start_date,
        request.end_date,
      );
    }

    // Group fixtures by date
    const fixturesByDate = new Map<string, PlayCricketFixture[]>();
    for (const f of fixtures) {
      const arr = fixturesByDate.get(f.matchDate) ?? [];
      arr.push(f);
      fixturesByDate.set(f.matchDate, arr);
    }

    // Fetch declarations
    const declarations = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "in", dateIds)
      .leftJoin("member", "member.id", "player_availability.member_id")
      .select([
        "player_availability.id",
        "player_availability.availability_date_id",
        "player_availability.member_id",
        "player_availability.status",
        "player_availability.notes",
        "player_availability.declared_at",
        "member.name as member_name",
      ])
      .orderBy("member.name", "asc")
      .execute();

    // Fetch assignments
    const assignments = await db
      .selectFrom("fixture_assignment")
      .where("availability_date_id", "in", dateIds)
      .leftJoin("member", "member.id", "fixture_assignment.member_id")
      .leftJoin("matchday", "matchday.id", "fixture_assignment.matchday_id")
      .select([
        "fixture_assignment.id",
        "fixture_assignment.availability_date_id",
        "fixture_assignment.matchday_id",
        "fixture_assignment.member_id",
        "member.name as member_name",
        "matchday.opposition",
      ])
      .execute();

    // Group
    const declarationsByDate = new Map<string, typeof declarations>();
    for (const d of declarations) {
      const arr = declarationsByDate.get(d.availability_date_id) ?? [];
      arr.push(d);
      declarationsByDate.set(d.availability_date_id, arr);
    }

    const assignmentsByDate = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const arr = assignmentsByDate.get(a.availability_date_id) ?? [];
      arr.push(a);
      assignmentsByDate.set(a.availability_date_id, arr);
    }

    // Group dates by match_date
    const datesByMatchDate = new Map<string, typeof dates>();
    for (const d of dates) {
      const arr = datesByMatchDate.get(d.match_date) ?? [];
      arr.push(d);
      datesByMatchDate.set(d.match_date, arr);
    }

    const uniqueDates = [...datesByMatchDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([matchDate, avDates]) => {
        const allDecl = avDates.flatMap(
          (d) => declarationsByDate.get(d.id) ?? [],
        );
        const allAssign = avDates.flatMap(
          (d) => assignmentsByDate.get(d.id) ?? [],
        );
        const dateFix = fixturesByDate.get(matchDate) ?? [];

        const available = allDecl.filter(
          (d) => d.status === "available",
        ).length;
        const maybe = allDecl.filter((d) => d.status === "maybe").length;
        const unavailable = allDecl.filter(
          (d) => d.status === "unavailable",
        ).length;

        return {
          matchDate,
          availabilityDateIds: avDates.map((d) => d.id),
          fixtures: dateFix,
          available,
          maybe,
          unavailable,
          totalResponses: allDecl.length,
          assignments: allAssign.length,
        };
      });

    return {
      ...request,
      dates: uniqueDates,
    };
  };
}

/**
 * Delete an availability request (cascades to dates, declarations, assignments).
 */
export function deleteRequest(db: Kysely<DB>) {
  return async (userId: string, role: string, requestId: string) => {
    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .select("id")
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    // Delete associated availability_date records first (which cascade to
    // player_availability and fixture_assignment)
    await db
      .deleteFrom("availability_date")
      .where("availability_request_id", "=", requestId)
      .execute();

    await db
      .deleteFrom("availability_request")
      .where("id", "=", requestId)
      .execute();

    return { success: true };
  };
}

/**
 * Preview fixtures in a date window from Play Cricket before creating a request.
 */
export function previewGamesInWindow(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient | null,
  siteId: string,
) {
  return async (
    userId: string,
    role: string,
    startDate: string,
    endDate: string,
  ) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);

    let fixtures: PlayCricketFixture[] = [];
    if (playCricketApi && accessibleIds.length > 0) {
      fixtures = await fetchFixturesInWindow(
        db,
        playCricketApi,
        siteId,
        accessibleIds,
        startDate,
        endDate,
      );
    }

    // Check for overlap
    const overlapping = await db
      .selectFrom("availability_request")
      .where("start_date", "<=", endDate)
      .where("end_date", ">=", startDate)
      .select("id")
      .executeTakeFirst();

    return {
      fixtures,
      overlapping: !!overlapping,
    };
  };
}

// ── Grid & assignment services (official) ──

/**
 * Get the availability grid for a specific date — all senior members
 * with their availability status. Includes Play Cricket fixtures (which may
 * not have matchday records yet) alongside existing matchday records.
 */
export function getAvailabilityGrid(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient | null,
  siteId: string,
) {
  return async (
    userId: string,
    role: string,
    requestId: string,
    matchDate: string,
  ) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (accessibleIds.length === 0) {
      throwHttpError(403, "You do not have access to any teams");
    }

    // Get all availability_date records for this request + match_date
    const avDates = await db
      .selectFrom("availability_date")
      .where("availability_request_id", "=", requestId)
      .where("match_date", "=", matchDate)
      .selectAll()
      .execute();

    if (avDates.length === 0) {
      throwHttpError(404, "No availability dates found for this request/date");
    }

    const dateIds = avDates.map((d) => d.id);

    // Get non-deleted senior members
    const members = await db
      .selectFrom("member")
      .where("deleted_at", "is", null)
      .where((eb) =>
        eb.or([
          eb("member_category", "!=", "junior"),
          eb("member_category", "is", null),
        ]),
      )
      .select(["id", "name", "email", "member_category"])
      .orderBy("name", "asc")
      .execute();

    // Get declarations across all availability_date records for this date
    const declarations = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "in", dateIds)
      .selectAll()
      .execute();

    // Get assignments
    const assignments = await db
      .selectFrom("fixture_assignment")
      .where("availability_date_id", "in", dateIds)
      .leftJoin("matchday", "matchday.id", "fixture_assignment.matchday_id")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .select([
        "fixture_assignment.id",
        "fixture_assignment.member_id",
        "fixture_assignment.matchday_id",
        "fixture_assignment.availability_date_id",
        "matchday.opposition",
        "matchday.play_cricket_team_id",
        "play_cricket_team.name as team_name",
      ])
      .execute();

    // Get matchdays on this date
    const matchdays = await db
      .selectFrom("matchday")
      .where("match_date", "=", matchDate)
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "matchday.play_cricket_team_id",
      )
      .select([
        "matchday.id",
        "matchday.opposition",
        "matchday.status",
        "matchday.play_cricket_team_id",
        "play_cricket_team.name as team_name",
      ])
      .execute();

    // Use first declaration per member (they declare per availability_date,
    // but from the member's perspective it's per-date)
    const declarationByMember = new Map<
      string,
      (typeof declarations)[number]
    >();
    for (const d of declarations) {
      if (!declarationByMember.has(d.member_id)) {
        declarationByMember.set(d.member_id, d);
      }
    }

    const assignmentsByMember = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const arr = assignmentsByMember.get(a.member_id) ?? [];
      arr.push(a);
      assignmentsByMember.set(a.member_id, arr);
    }

    const grid = members.map((member) => {
      const declaration = declarationByMember.get(member.id);
      const memberAssignments = assignmentsByMember.get(member.id) ?? [];
      return {
        memberId: member.id,
        memberName: member.name,
        memberCategory: member.member_category,
        availabilityStatus: declaration?.status ?? null,
        availabilityNotes: declaration?.notes ?? null,
        declaredAt: declaration?.declared_at ?? null,
        assignments: memberAssignments.map((a) => ({
          assignmentId: a.id,
          matchdayId: a.matchday_id,
          opposition: a.opposition,
          teamName: a.team_name,
          teamId: a.play_cricket_team_id,
        })),
      };
    });

    // Fetch Play Cricket fixtures for this date to show all games
    // (including ones without matchday records)
    let fixtures: PlayCricketFixture[] = [];
    if (playCricketApi) {
      fixtures = await fetchFixturesInWindow(
        db,
        playCricketApi,
        siteId,
        accessibleIds,
        matchDate,
        matchDate,
      );
    }

    return {
      matchDate,
      availabilityDateIds: dateIds,
      matchdays,
      fixtures,
      grid,
    };
  };
}

/**
 * Officials can set availability on behalf of a member.
 */
export function setAvailabilityForMember(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    dateId: string,
    data: SetAvailabilityForMember,
  ) => {
    const date = await db
      .selectFrom("availability_date")
      .where("id", "=", dateId)
      .select(["id", "play_cricket_team_id"])
      .executeTakeFirst();

    if (!date) throwHttpError(404, "Availability date not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(date.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this team");
    }

    const now = new Date().toISOString();

    const existing = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "=", dateId)
      .where("member_id", "=", data.memberId)
      .select("id")
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("player_availability")
        .set({
          status: data.status,
          notes: data.notes ?? null,
          declared_at: now,
        })
        .where("id", "=", existing.id)
        .execute();

      return { id: existing.id };
    }

    const id = crypto.randomUUID();
    await db
      .insertInto("player_availability")
      .values({
        id,
        availability_date_id: dateId,
        member_id: data.memberId,
        status: data.status,
        notes: data.notes ?? null,
        declared_at: now,
      })
      .execute();

    return { id };
  };
}

/**
 * Assign a player to a fixture from the grid.
 * Creates the matchday record on-the-fly if it doesn't exist yet.
 */
export function assignPlayer(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    dateId: string,
    data: AssignPlayer,
  ) => {
    const date = await db
      .selectFrom("availability_date")
      .where("id", "=", dateId)
      .select(["id", "play_cricket_team_id", "match_date"])
      .executeTakeFirst();

    if (!date) throwHttpError(404, "Availability date not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(data.teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    // Find or create the matchday for this team + date
    let matchday = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", data.teamId)
      .where("match_date", "=", date.match_date)
      .select("id")
      .executeTakeFirst();

    if (!matchday) {
      const matchdayId = crypto.randomUUID();
      await db
        .insertInto("matchday")
        .values({
          id: matchdayId,
          play_cricket_team_id: data.teamId,
          match_date: date.match_date,
          opposition: data.opposition,
          competition_type: data.competitionType ?? null,
          play_cricket_match_id: data.playCricketMatchId ?? null,
          status: "pending",
          created_by: userId,
        })
        .execute();
      matchday = { id: matchdayId };
    }

    // Find the correct availability_date for this team (may differ from dateId
    // if the request has multiple teams on the same date)
    let targetDateId = dateId;
    if (date.play_cricket_team_id !== data.teamId) {
      const teamDate = await db
        .selectFrom("availability_date")
        .where("availability_request_id", "in", (qb) =>
          qb
            .selectFrom("availability_date")
            .where("id", "=", dateId)
            .select("availability_request_id"),
        )
        .where("play_cricket_team_id", "=", data.teamId)
        .where("match_date", "=", date.match_date)
        .select("id")
        .executeTakeFirst();
      if (teamDate) targetDateId = teamDate.id;
    }

    // Check for duplicate assignment
    const existing = await db
      .selectFrom("fixture_assignment")
      .where("matchday_id", "=", matchday.id)
      .where("member_id", "=", data.memberId)
      .select("id")
      .executeTakeFirst();

    if (existing) {
      throwHttpError(409, "Player is already assigned to this fixture");
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db
      .insertInto("fixture_assignment")
      .values({
        id,
        availability_date_id: targetDateId,
        matchday_id: matchday.id,
        member_id: data.memberId,
        assigned_by: userId,
        assigned_at: now,
      })
      .execute();

    return { id, matchdayId: matchday.id };
  };
}

/**
 * Unassign a player from a fixture (by team).
 */
export function unassignPlayer(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    dateId: string,
    data: UnassignPlayer,
  ) => {
    const date = await db
      .selectFrom("availability_date")
      .where("id", "=", dateId)
      .select(["id", "play_cricket_team_id", "match_date"])
      .executeTakeFirst();

    if (!date) throwHttpError(404, "Availability date not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(data.teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    // Find the matchday for this team + date
    const matchday = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", data.teamId)
      .where("match_date", "=", date.match_date)
      .select("id")
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    const assignment = await db
      .selectFrom("fixture_assignment")
      .where("matchday_id", "=", matchday.id)
      .where("member_id", "=", data.memberId)
      .select("id")
      .executeTakeFirst();

    if (!assignment) throwHttpError(404, "Assignment not found");

    await db
      .deleteFrom("fixture_assignment")
      .where("id", "=", assignment.id)
      .execute();

    return { success: true };
  };
}

// ── Member services ──

/**
 * Get availability dates visible to the current member.
 */
export function getMyAvailability(db: Kysely<DB>) {
  return async (userId: string) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select(["email"])
      .executeTakeFirst();

    if (!user) throwHttpError(401, "User not found");

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .where("deleted_at", "is", null)
      .select(["id"])
      .executeTakeFirst();

    if (!member) {
      return { memberId: null, dates: [] };
    }

    // Get all availability dates ordered by date
    const dates = await db
      .selectFrom("availability_date")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "availability_date.play_cricket_team_id",
      )
      .select([
        "availability_date.id",
        "availability_date.match_date",
        "availability_date.play_cricket_team_id",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("availability_date.match_date", "asc")
      .execute();

    if (dates.length === 0) return { memberId: member.id, dates: [] };

    const dateIds = dates.map((d) => d.id);

    const myDeclarations = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "in", dateIds)
      .where("member_id", "=", member.id)
      .selectAll()
      .execute();

    const declarationByDate = new Map(
      myDeclarations.map((d) => [d.availability_date_id, d]),
    );

    const myAssignments = await db
      .selectFrom("fixture_assignment")
      .where("availability_date_id", "in", dateIds)
      .where("member_id", "=", member.id)
      .leftJoin("matchday", "matchday.id", "fixture_assignment.matchday_id")
      .select([
        "fixture_assignment.availability_date_id",
        "fixture_assignment.matchday_id",
        "matchday.opposition",
        "matchday.play_cricket_team_id as matchday_team_id",
      ])
      .execute();

    const assignmentsByDate = new Map<string, typeof myAssignments>();
    for (const a of myAssignments) {
      const arr = assignmentsByDate.get(a.availability_date_id) ?? [];
      arr.push(a);
      assignmentsByDate.set(a.availability_date_id, arr);
    }

    const matchDates = [...new Set(dates.map((d) => d.match_date))];
    const matchdays = await db
      .selectFrom("matchday")
      .where("match_date", "in", matchDates)
      .select(["id", "match_date", "opposition", "play_cricket_team_id"])
      .execute();

    const matchdaysByDate = new Map<string, typeof matchdays>();
    for (const m of matchdays) {
      const arr = matchdaysByDate.get(m.match_date) ?? [];
      arr.push(m);
      matchdaysByDate.set(m.match_date, arr);
    }

    return {
      memberId: member.id,
      dates: dates.map((date) => ({
        ...date,
        myStatus: declarationByDate.get(date.id)?.status ?? null,
        myNotes: declarationByDate.get(date.id)?.notes ?? null,
        myAssignments: assignmentsByDate.get(date.id) ?? [],
        matchdays: matchdaysByDate.get(date.match_date) ?? [],
      })),
    };
  };
}

/**
 * Member declares their own availability for a date.
 */
export function declareAvailability(db: Kysely<DB>) {
  return async (userId: string, dateId: string, data: DeclareAvailability) => {
    const user = await db
      .selectFrom("user")
      .where("id", "=", userId)
      .select(["email"])
      .executeTakeFirst();

    if (!user) throwHttpError(401, "User not found");

    const member = await db
      .selectFrom("member")
      .where("email", "=", user.email)
      .where("deleted_at", "is", null)
      .select(["id"])
      .executeTakeFirst();

    if (!member) throwHttpError(403, "No member record linked to your account");

    const date = await db
      .selectFrom("availability_date")
      .where("id", "=", dateId)
      .select("id")
      .executeTakeFirst();

    if (!date) throwHttpError(404, "Availability date not found");

    const now = new Date().toISOString();

    const existing = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "=", dateId)
      .where("member_id", "=", member.id)
      .select("id")
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("player_availability")
        .set({
          status: data.status,
          notes: data.notes ?? null,
          declared_at: now,
        })
        .where("id", "=", existing.id)
        .execute();

      return { id: existing.id };
    }

    const id = crypto.randomUUID();
    await db
      .insertInto("player_availability")
      .values({
        id,
        availability_date_id: dateId,
        member_id: member.id,
        status: data.status,
        notes: data.notes ?? null,
        declared_at: now,
      })
      .execute();

    return { id };
  };
}
