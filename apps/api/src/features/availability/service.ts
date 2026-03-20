import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type {
  AssignPlayer,
  CreateAvailabilityDate,
  DeclareAvailability,
  ListAvailabilityDates,
  SetAvailabilityForMember,
  UnassignPlayer,
} from "./schemas.ts";

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

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

// ── Official services ──

/**
 * Create an availability date for a team.
 * Officials pick specific dates to request availability for.
 */
export function createAvailabilityDate(db: Kysely<DB>) {
  return async (userId: string, role: string, data: CreateAvailabilityDate) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(data.teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    // Check for duplicate
    const existing = await db
      .selectFrom("availability_date")
      .where("play_cricket_team_id", "=", data.teamId)
      .where("match_date", "=", data.matchDate)
      .select("id")
      .executeTakeFirst();

    if (existing) {
      throwHttpError(
        409,
        "An availability date already exists for this team and date",
      );
    }

    const id = crypto.randomUUID();

    await db
      .insertInto("availability_date")
      .values({
        id,
        play_cricket_team_id: data.teamId,
        match_date: data.matchDate,
        created_by: userId,
      })
      .execute();

    return { id };
  };
}

/**
 * List availability dates for a team with player responses and assignments.
 */
export function listAvailabilityDates(db: Kysely<DB>) {
  return async (
    userId: string,
    role: string,
    params: ListAvailabilityDates,
  ) => {
    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(params.teamId)) {
      throwHttpError(403, "You do not have access to this team");
    }

    const dates = await db
      .selectFrom("availability_date")
      .where("play_cricket_team_id", "=", params.teamId)
      .selectAll()
      .orderBy("match_date", "asc")
      .execute();

    if (dates.length === 0) return [];

    const dateIds = dates.map((d) => d.id);

    // Fetch all availability declarations for these dates
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
        "member.email as member_email",
        "member.member_category",
      ])
      .orderBy("member.name", "asc")
      .execute();

    // Fetch all fixture assignments for these dates
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
        "fixture_assignment.assigned_at",
        "member.name as member_name",
        "matchday.opposition",
        "matchday.play_cricket_team_id as matchday_team_id",
      ])
      .execute();

    // Fetch matchdays on these dates for the team
    const matchDates = dates.map((d) => d.match_date);
    const matchdays = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", params.teamId)
      .where("match_date", "in", matchDates)
      .select(["id", "match_date", "opposition", "status"])
      .execute();

    // Group by date
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

    const matchdaysByDate = new Map<string, typeof matchdays>();
    for (const m of matchdays) {
      const arr = matchdaysByDate.get(m.match_date) ?? [];
      arr.push(m);
      matchdaysByDate.set(m.match_date, arr);
    }

    return dates.map((date) => ({
      ...date,
      declarations: declarationsByDate.get(date.id) ?? [],
      assignments: assignmentsByDate.get(date.id) ?? [],
      matchdays: matchdaysByDate.get(date.match_date) ?? [],
    }));
  };
}

/**
 * Delete an availability date (and cascade declarations/assignments).
 */
export function deleteAvailabilityDate(db: Kysely<DB>) {
  return async (userId: string, role: string, dateId: string) => {
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

    await db.deleteFrom("availability_date").where("id", "=", dateId).execute();

    return { success: true };
  };
}

/**
 * Get the availability grid for a specific date — all members who are eligible
 * for the team plus their availability status.
 */
export function getAvailabilityGrid(db: Kysely<DB>) {
  return async (userId: string, role: string, dateId: string) => {
    const date = await db
      .selectFrom("availability_date")
      .where("id", "=", dateId)
      .selectAll()
      .executeTakeFirst();

    if (!date) throwHttpError(404, "Availability date not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(date.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this team");
    }

    // Check if this is a junior team
    const team = await db
      .selectFrom("play_cricket_team")
      .where("id", "=", date.play_cricket_team_id)
      .select("is_junior")
      .executeTakeFirst();

    // Filter members by team type: junior teams show juniors, senior teams exclude juniors
    let membersQuery = db
      .selectFrom("member")
      .where("deleted_at", "is", null)
      .select(["id", "name", "email", "member_category"])
      .orderBy("name", "asc");

    if (team?.is_junior) {
      membersQuery = membersQuery.where("member_category", "=", "junior");
    } else {
      membersQuery = membersQuery.where((eb) =>
        eb.or([
          eb("member_category", "!=", "junior"),
          eb("member_category", "is", null),
        ]),
      );
    }

    const members = await membersQuery.execute();

    // Get declarations for this date
    const declarations = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "=", dateId)
      .selectAll()
      .execute();

    // Get assignments for this date
    const assignments = await db
      .selectFrom("fixture_assignment")
      .where("availability_date_id", "=", dateId)
      .leftJoin("matchday", "matchday.id", "fixture_assignment.matchday_id")
      .select([
        "fixture_assignment.id",
        "fixture_assignment.member_id",
        "fixture_assignment.matchday_id",
        "matchday.opposition",
      ])
      .execute();

    // Get matchdays on this date for the team
    const matchdays = await db
      .selectFrom("matchday")
      .where("play_cricket_team_id", "=", date.play_cricket_team_id)
      .where("match_date", "=", date.match_date)
      .select(["id", "opposition", "status", "play_cricket_team_id"])
      .execute();

    const declarationByMember = new Map(
      declarations.map((d) => [d.member_id, d]),
    );
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
        memberEmail: member.email,
        memberCategory: member.member_category,
        availabilityStatus: declaration?.status ?? null,
        availabilityNotes: declaration?.notes ?? null,
        declaredAt: declaration?.declared_at ?? null,
        assignments: memberAssignments.map((a) => ({
          assignmentId: a.id,
          matchdayId: a.matchday_id,
          opposition: a.opposition,
        })),
      };
    });

    return {
      date,
      matchdays,
      grid,
    };
  };
}

/**
 * Officials can set availability on behalf of a member (or override).
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

    // Upsert: check if declaration already exists
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
 * Assign a player to a matchday from the availability grid.
 * Captains can assign ANY member, regardless of availability status.
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
    if (!accessibleIds.includes(date.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this team");
    }

    // Verify the matchday exists and is on the same date
    const matchday = await db
      .selectFrom("matchday")
      .where("id", "=", data.matchdayId)
      .select(["id", "match_date", "play_cricket_team_id"])
      .executeTakeFirst();

    if (!matchday) throwHttpError(404, "Matchday not found");

    if (matchday.match_date !== date.match_date) {
      throwHttpError(400, "Matchday is not on the same date");
    }

    if (matchday.play_cricket_team_id !== date.play_cricket_team_id) {
      throwHttpError(400, "Matchday belongs to a different team");
    }

    // Check for duplicate assignment
    const existing = await db
      .selectFrom("fixture_assignment")
      .where("matchday_id", "=", data.matchdayId)
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
        availability_date_id: dateId,
        matchday_id: data.matchdayId,
        member_id: data.memberId,
        assigned_by: userId,
        assigned_at: now,
      })
      .execute();

    return { id };
  };
}

/**
 * Unassign a player from a matchday.
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
      .select(["id", "play_cricket_team_id"])
      .executeTakeFirst();

    if (!date) throwHttpError(404, "Availability date not found");

    const accessibleIds = await getAccessibleTeamIds(db, userId, role);
    if (!accessibleIds.includes(date.play_cricket_team_id)) {
      throwHttpError(403, "You do not have access to this team");
    }

    const assignment = await db
      .selectFrom("fixture_assignment")
      .where("availability_date_id", "=", dateId)
      .where("matchday_id", "=", data.matchdayId)
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
 * Get availability dates visible to the current member (linked via user->member).
 */
export function getMyAvailability(db: Kysely<DB>) {
  return async (userId: string) => {
    // Find the member linked to this user via email
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

    // Get all availability dates (all teams) ordered by date
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

    // Get my declarations
    const myDeclarations = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "in", dateIds)
      .where("member_id", "=", member.id)
      .selectAll()
      .execute();

    const declarationByDate = new Map(
      myDeclarations.map((d) => [d.availability_date_id, d]),
    );

    // Get my assignments
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

    // Get matchdays on these dates
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
    // Find member for this user
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

    // Verify date exists
    const date = await db
      .selectFrom("availability_date")
      .where("id", "=", dateId)
      .select("id")
      .executeTakeFirst();

    if (!date) throwHttpError(404, "Availability date not found");

    const now = new Date().toISOString();

    // Upsert
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

/**
 * Get members who would receive an availability request email for a date.
 * Returns list of members with their email addresses, so officials can
 * preview/adjust before sending.
 */
export function getEmailRecipients(db: Kysely<DB>) {
  return async (userId: string, role: string, dateId: string) => {
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

    // Check if this is a junior team
    const team = await db
      .selectFrom("play_cricket_team")
      .where("id", "=", date.play_cricket_team_id)
      .select("is_junior")
      .executeTakeFirst();

    // Get all non-deleted members with email addresses, filtered by team type
    let membersQuery = db
      .selectFrom("member")
      .where("deleted_at", "is", null)
      .where("email", "is not", null)
      .select(["id", "name", "email", "member_category"])
      .orderBy("name", "asc");

    if (team?.is_junior) {
      membersQuery = membersQuery.where("member_category", "=", "junior");
    } else {
      membersQuery = membersQuery.where((eb) =>
        eb.or([
          eb("member_category", "!=", "junior"),
          eb("member_category", "is", null),
        ]),
      );
    }

    const members = await membersQuery.execute();

    // Check who has already declared
    const declared = await db
      .selectFrom("player_availability")
      .where("availability_date_id", "=", dateId)
      .select(["member_id", "status"])
      .execute();

    const declaredMap = new Map(declared.map((d) => [d.member_id, d.status]));

    return members.map((m) => ({
      memberId: m.id,
      name: m.name,
      email: m.email,
      memberCategory: m.member_category,
      alreadyDeclared: declaredMap.has(m.id),
      currentStatus: declaredMap.get(m.id) ?? null,
    }));
  };
}
