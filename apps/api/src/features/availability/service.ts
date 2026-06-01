import type { DB } from "@percy-main/db";
import { AvailabilityRequest } from "@percy-main/email";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { createElement } from "react";
import { render } from "react-email";
import type { SendPush } from "../../lib/push-sender.ts";
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
  AssignPlayer,
  CreateRequest,
  ListRequests,
  NotifySend,
  Respond,
  SetAvailability,
  UpdateRequestStatus,
} from "./schemas.ts";

type SendEmail = (email: {
  to: string;
  subject: string;
  html: string;
}) => Promise<void>;

// ── Helpers ──

function throwHttpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

/**
 * Parse Play Cricket date (dd/MM/yyyy) to ISO date (YYYY-MM-DD).
 * String manipulation avoids timezone issues with Date objects.
 */
function pcDateToIso(pcDate: string): string {
  const [dd, mm, yyyy] = pcDate.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

// ── Official Services ──

export function createRequest(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient,
  siteId: string,
  sendEmail: SendEmail,
  sendPush: SendPush,
  baseUrl: string,
) {
  const dispatchNotifications = sendAvailabilityNotification(
    db,
    sendEmail,
    sendPush,
    baseUrl,
  );

  return async (
    userId: string,
    data: CreateRequest,
    log: FastifyBaseLogger,
  ) => {
    if (data.dateFrom > data.dateTo) {
      throwHttpError(400, "dateFrom must be before or equal to dateTo");
    }

    // Check for global overlap with any open request
    const overlap = await db
      .selectFrom("availability_request")
      .where("status", "=", "open")
      .where("date_from", "<=", data.dateTo)
      .where("date_to", ">=", data.dateFrom)
      .select("id")
      .executeTakeFirst();

    if (overlap) {
      throwHttpError(
        409,
        "An availability request already exists that overlaps with this date range",
      );
    }

    const groups = await db
      .selectFrom("user_group")
      .where("id", "in", data.userGroupIds)
      .select("id")
      .execute();

    if (groups.length !== data.userGroupIds.length) {
      throwHttpError(400, "One or more selected user groups do not exist");
    }

    // Fetch senior team IDs
    const seniorTeams = await db
      .selectFrom("play_cricket_team")
      .where("is_junior", "=", false)
      .select("id")
      .execute();

    const seniorTeamIds = new Set(seniorTeams.map((t) => t.id));

    // Fetch fixtures from Play Cricket API
    const currentYear = new Date().getFullYear();
    const fromYear = parseInt(data.dateFrom.slice(0, 4), 10);
    const toYear = parseInt(data.dateTo.slice(0, 4), 10);
    const seasons = [
      ...new Set([fromYear, toYear, currentYear].filter((y) => y > 0)),
    ];

    const summaries = await Promise.all(
      seasons.map((season) => playCricketApi.getMatchesSummary(season)),
    );
    const allMatches = summaries.flatMap((s) => s.matches);

    // Filter to our senior teams within date range
    const fixtures = allMatches
      .filter((m) => {
        const isoDate = pcDateToIso(m.match_date);
        if (isoDate < data.dateFrom || isoDate > data.dateTo) return false;

        const isHome = m.home_club_id === siteId;
        const isAway = m.away_club_id === siteId;
        if (!isHome && !isAway) return false;

        const ourTeamId = isHome ? m.home_team_id : m.away_team_id;
        return seniorTeamIds.has(ourTeamId);
      })
      .map((m) => {
        const isHome = m.home_club_id === siteId;
        return {
          matchDate: pcDateToIso(m.match_date),
          playCricketMatchId: m.id.toString(),
          playCricketTeamId: isHome ? m.home_team_id : m.away_team_id,
          opposition: isHome
            ? `${m.away_club_name} ${m.away_team_name}`
            : `${m.home_club_name} ${m.home_team_name}`,
          isHome,
          competitionName: m.competition_name ?? null,
          competitionType: m.competition_type ?? null,
          matchTime: m.match_time ?? null,
        };
      });

    const requestId = crypto.randomUUID();

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("availability_request")
        .values({
          id: requestId,
          created_by: userId,
          date_from: data.dateFrom,
          date_to: data.dateTo,
          status: "open",
        })
        .execute();

      await trx
        .insertInto("availability_request_group")
        .values(
          data.userGroupIds.map((groupId) => ({
            request_id: requestId,
            user_group_id: groupId,
          })),
        )
        .execute();

      for (const fixture of fixtures) {
        await trx
          .insertInto("availability_fixture")
          .values({
            id: crypto.randomUUID(),
            availability_request_id: requestId,
            match_date: fixture.matchDate,
            play_cricket_match_id: fixture.playCricketMatchId,
            play_cricket_team_id: fixture.playCricketTeamId,
            opposition: fixture.opposition,
            is_home: fixture.isHome,
            competition_name: fixture.competitionName,
            competition_type: fixture.competitionType,
            match_time: fixture.matchTime,
          })
          .execute();
      }
    });

    const recipients = await resolveRecipients(
      db,
      data.userGroupIds,
      data.additionalEmails ?? [],
    );

    const result = await dispatchNotifications(requestId, { recipients }, log);

    return {
      id: requestId,
      fixtureCount: fixtures.length,
      notify: {
        sent: result.sent,
        failed: result.failed,
        recipientCount: recipients.length,
      },
    };
  };
}

async function resolveRecipients(
  db: Kysely<DB>,
  userGroupIds: string[],
  additionalEmails: string[],
): Promise<Array<{ email: string; name: string | null }>> {
  const members = await db
    .selectFrom("member")
    .innerJoin("user_group_member", "user_group_member.member_id", "member.id")
    .where("user_group_member.group_id", "in", userGroupIds)
    .where("member.deleted_at", "is", null)
    .where("member.email", "is not", null)
    .select(["member.email", "member.name"])
    .execute();

  const seen = new Set<string>();
  const recipients: Array<{ email: string; name: string | null }> = [];
  for (const m of members) {
    if (!m.email) continue;
    const key = m.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email: m.email, name: m.name });
  }
  for (const email of additionalEmails) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email, name: null });
  }
  return recipients;
}

export function listRequests(db: Kysely<DB>) {
  return async (params: ListRequests) => {
    const { limit, offset } = params;

    const requests = await db
      .selectFrom("availability_request")
      .leftJoin("user", "user.id", "availability_request.created_by")
      .select([
        "availability_request.id",
        "availability_request.date_from",
        "availability_request.date_to",
        "availability_request.status",
        "availability_request.created_at",
        "availability_request.created_by",
        "user.name as created_by_name",
      ])
      .orderBy("availability_request.created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    // Get fixture and response counts per request
    const requestIds = requests.map((r) => r.id);
    if (requestIds.length === 0) return { items: [] };

    const fixtureCounts = await db
      .selectFrom("availability_fixture")
      .where("availability_request_id", "in", requestIds)
      .groupBy("availability_request_id")
      .select([
        "availability_request_id",
        db.fn.countAll<string>().as("fixture_count"),
      ])
      .execute();

    const responseCounts = await db
      .selectFrom("availability_response")
      .where("availability_request_id", "in", requestIds)
      .groupBy("availability_request_id")
      .select([
        "availability_request_id",
        db.fn.count<string>("member_id").distinct().as("respondent_count"),
      ])
      .execute();

    const fixtureMap = new Map(
      fixtureCounts.map((r) => [
        r.availability_request_id,
        Number(r.fixture_count),
      ]),
    );
    const responseMap = new Map(
      responseCounts.map((r) => [
        r.availability_request_id,
        Number(r.respondent_count),
      ]),
    );

    // Pull the actual fixtures so the list cards can show what's in
    // each request (team + opposition + date) without a per-card
    // round-trip.
    const fixtures = await db
      .selectFrom("availability_fixture")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "availability_fixture.play_cricket_team_id",
      )
      .where("availability_request_id", "in", requestIds)
      .select([
        "availability_fixture.id",
        "availability_fixture.availability_request_id",
        "availability_fixture.match_date",
        "availability_fixture.opposition",
        "availability_fixture.is_home",
        "availability_fixture.competition_name",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("availability_fixture.match_date", "asc")
      .orderBy("play_cricket_team.name", "asc")
      .execute();

    const fixturesByRequest = new Map<string, typeof fixtures>();
    for (const f of fixtures) {
      const list = fixturesByRequest.get(f.availability_request_id) ?? [];
      list.push(f);
      fixturesByRequest.set(f.availability_request_id, list);
    }

    return {
      items: requests.map((r) => ({
        ...r,
        fixtureCount: fixtureMap.get(r.id) ?? 0,
        respondentCount: responseMap.get(r.id) ?? 0,
        fixtures: (fixturesByRequest.get(r.id) ?? []).map((f) => ({
          id: f.id,
          match_date: f.match_date,
          opposition: f.opposition,
          is_home: f.is_home,
          team_name: f.team_name,
          competition_name: f.competition_name,
        })),
      })),
    };
  };
}

export function getRequest(db: Kysely<DB>) {
  return async (requestId: string) => {
    const request = await db
      .selectFrom("availability_request")
      .leftJoin("user", "user.id", "availability_request.created_by")
      .where("availability_request.id", "=", requestId)
      .select([
        "availability_request.id",
        "availability_request.date_from",
        "availability_request.date_to",
        "availability_request.status",
        "availability_request.created_at",
        "availability_request.created_by",
        "user.name as created_by_name",
      ])
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    const fixtures = await db
      .selectFrom("availability_fixture")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "availability_fixture.play_cricket_team_id",
      )
      .where("availability_request_id", "=", requestId)
      .select([
        "availability_fixture.id",
        "availability_fixture.availability_request_id",
        "availability_fixture.match_date",
        "availability_fixture.play_cricket_match_id",
        "availability_fixture.play_cricket_team_id",
        "availability_fixture.opposition",
        "availability_fixture.is_home",
        "availability_fixture.competition_name",
        "availability_fixture.competition_type",
        "availability_fixture.match_time",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("match_date", "asc")
      .orderBy("play_cricket_team.name", "asc")
      .execute();

    // Group fixtures by date and get counts
    const dates = new Map<
      string,
      {
        date: string;
        fixtures: typeof fixtures;
        responseCount: number;
        assignmentCount: number;
        confirmedCount: number;
      }
    >();

    for (const fixture of fixtures) {
      if (!dates.has(fixture.match_date)) {
        dates.set(fixture.match_date, {
          date: fixture.match_date,
          fixtures: [],
          responseCount: 0,
          assignmentCount: 0,
          confirmedCount: 0,
        });
      }
      const entry = dates.get(fixture.match_date);
      if (entry) entry.fixtures.push(fixture);
    }

    // Count fixtures already confirmed into a (non-cancelled) matchday,
    // per date, so the detail cards can show which dates are locked in.
    const pcMatchIds = fixtures.map((f) => f.play_cricket_match_id);
    const confirmedMatchdays =
      pcMatchIds.length > 0
        ? await db
            .selectFrom("matchday")
            .where("play_cricket_match_id", "in", pcMatchIds)
            .where("status", "!=", "cancelled")
            .select(["play_cricket_match_id"])
            .execute()
        : [];
    const confirmedPcMatchIds = new Set(
      confirmedMatchdays.map((m) => m.play_cricket_match_id),
    );
    for (const entry of dates.values()) {
      entry.confirmedCount = entry.fixtures.filter((f) =>
        confirmedPcMatchIds.has(f.play_cricket_match_id),
      ).length;
    }

    // Get response counts per date
    const responses = await db
      .selectFrom("availability_response")
      .where("availability_request_id", "=", requestId)
      .groupBy("match_date")
      .select(["match_date", db.fn.countAll<string>().as("response_count")])
      .execute();

    for (const r of responses) {
      const entry = dates.get(r.match_date);
      if (entry) entry.responseCount = Number(r.response_count);
    }

    // Get assignment counts per date
    const fixtureIds = fixtures.map((f) => f.id);
    if (fixtureIds.length > 0) {
      const assignments = await db
        .selectFrom("availability_assignment")
        .innerJoin(
          "availability_fixture",
          "availability_fixture.id",
          "availability_assignment.availability_fixture_id",
        )
        .where("availability_fixture.availability_request_id", "=", requestId)
        .groupBy("availability_fixture.match_date")
        .select([
          "availability_fixture.match_date",
          db.fn.countAll<string>().as("assignment_count"),
        ])
        .execute();

      for (const a of assignments) {
        const entry = dates.get(a.match_date);
        if (entry) entry.assignmentCount = Number(a.assignment_count);
      }
    }

    return {
      request,
      dates: Array.from(dates.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    };
  };
}

export function getDateDetail(db: Kysely<DB>) {
  return async (requestId: string, date: string) => {
    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .select(["id", "status"])
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    const requestGroupIds = (
      await db
        .selectFrom("availability_request_group")
        .where("request_id", "=", requestId)
        .select("user_group_id")
        .execute()
    ).map((r) => r.user_group_id);

    // Get fixtures for this date
    const fixtures = await db
      .selectFrom("availability_fixture")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "availability_fixture.play_cricket_team_id",
      )
      .where("availability_fixture.availability_request_id", "=", requestId)
      .where("availability_fixture.match_date", "=", date)
      .select([
        "availability_fixture.id",
        "availability_fixture.match_date",
        "availability_fixture.play_cricket_match_id",
        "availability_fixture.play_cricket_team_id",
        "availability_fixture.opposition",
        "availability_fixture.is_home",
        "availability_fixture.competition_name",
        "availability_fixture.match_time",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("play_cricket_team.name", "asc")
      .execute();

    if (fixtures.length === 0) {
      throwHttpError(404, "No fixtures found for this date");
    }

    // Get assignments per fixture
    const fixtureIds = fixtures.map((f) => f.id);
    const assignments = await db
      .selectFrom("availability_assignment")
      .where("availability_fixture_id", "in", fixtureIds)
      .selectAll()
      .orderBy("position", "asc")
      .execute();

    const assignmentsByFixture = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const list = assignmentsByFixture.get(a.availability_fixture_id) ?? [];
      list.push(a);
      assignmentsByFixture.set(a.availability_fixture_id, list);
    }

    // A fixture is "confirmed" once a non-cancelled matchday exists for
    // its Play Cricket match. Keyed by play_cricket_match_id (1:1 with the
    // fixture) so the picker can show "Manage squad" instead of "Confirm
    // team" for teams already locked in.
    const pcMatchIds = fixtures.map((f) => f.play_cricket_match_id);
    const matchdays =
      pcMatchIds.length > 0
        ? await db
            .selectFrom("matchday")
            .where("play_cricket_match_id", "in", pcMatchIds)
            .where("status", "!=", "cancelled")
            .select(["id", "play_cricket_match_id"])
            .execute()
        : [];
    const matchdayByPcMatchId = new Map(
      matchdays.map((m) => [m.play_cricket_match_id, m.id]),
    );

    // Per amendments §2: all responses surface to officials, regardless
    // of whether the responder is in one of the request's user groups.
    // (The pre-amendment behaviour filtered non-group respondents out.)
    const responses = await db
      .selectFrom("availability_response")
      .innerJoin("member", "member.id", "availability_response.member_id")
      .where("availability_response.availability_request_id", "=", requestId)
      .where("availability_response.match_date", "=", date)
      .select([
        "availability_response.id",
        "availability_response.member_id",
        "availability_response.status",
        "availability_response.note",
        "availability_response.overridden_by",
        "member.name as member_name",
      ])
      .orderBy("member.name", "asc")
      .execute();

    // The no-response pool stays scoped to the union of the request's
    // user groups - without a group anchor it would be every member in
    // the club, which is rarely what an official wants to see. A request
    // with zero groups (legacy data) yields an empty pool rather than a
    // SQL `IN ()` syntax error.
    const allMembers =
      requestGroupIds.length === 0
        ? []
        : await db
            .selectFrom("member")
            .innerJoin(
              "user_group_member",
              "user_group_member.member_id",
              "member.id",
            )
            .where("user_group_member.group_id", "in", requestGroupIds)
            .where("member.deleted_at", "is", null)
            .select(["member.id", "member.name", "member.member_category"])
            .distinct()
            .orderBy("member.name", "asc")
            .execute();

    const respondedMemberIds = new Set(responses.map((r) => r.member_id));
    const noResponse = allMembers.filter((m) => !respondedMemberIds.has(m.id));

    const available = responses.filter((r) => r.status === "available");
    const unavailable = responses.filter((r) => r.status === "unavailable");

    // Build assigned member IDs set (across all fixtures on this date)
    const assignedMemberIds = new Set<string>();
    for (const list of assignmentsByFixture.values()) {
      for (const a of list) {
        if (a.member_id) assignedMemberIds.add(a.member_id);
      }
    }

    return {
      requestStatus: request.status,
      fixtures: fixtures.map((f) => ({
        ...f,
        assignments: assignmentsByFixture.get(f.id) ?? [],
        matchdayId: matchdayByPcMatchId.get(f.play_cricket_match_id) ?? null,
      })),
      pools: {
        available,
        unavailable,
        noResponse,
      },
      assignedMemberIds: Array.from(assignedMemberIds),
    };
  };
}

export function assignPlayer(db: Kysely<DB>) {
  return async (requestId: string, date: string, data: AssignPlayer) => {
    // Verify the fixture belongs to this request and date
    const fixture = await db
      .selectFrom("availability_fixture")
      .where("id", "=", data.fixtureId)
      .where("availability_request_id", "=", requestId)
      .where("match_date", "=", date)
      .select("id")
      .executeTakeFirst();

    if (!fixture) {
      throwHttpError(404, "Fixture not found for this request and date");
    }

    // Check for duplicate member assignment to this fixture
    if (data.memberId) {
      const existing = await db
        .selectFrom("availability_assignment")
        .where("availability_fixture_id", "=", data.fixtureId)
        .where("member_id", "=", data.memberId)
        .select("id")
        .executeTakeFirst();

      if (existing) {
        throwHttpError(409, "This player is already assigned to this fixture");
      }
    }

    // Count current assignments and get next position
    const currentCount = await db
      .selectFrom("availability_assignment")
      .where("availability_fixture_id", "=", data.fixtureId)
      .select([
        db.fn.countAll<string>().as("count"),
        db.fn.max("position").as("max_pos"),
      ])
      .executeTakeFirst();

    const count = Number(currentCount?.count ?? 0);
    if (count >= 11) {
      throwHttpError(400, "Maximum of 11 players per team");
    }

    const position = ((currentCount?.max_pos as number | null) ?? 0) + 1;

    const id = crypto.randomUUID();
    await db
      .insertInto("availability_assignment")
      .values({
        id,
        availability_fixture_id: data.fixtureId,
        member_id: data.memberId ?? null,
        player_name: data.playerName,
        position,
      })
      .execute();

    return { id, position };
  };
}

export function removeAssignment(db: Kysely<DB>) {
  return async (assignmentId: string) => {
    const assignment = await db
      .selectFrom("availability_assignment")
      .where("id", "=", assignmentId)
      .select(["id", "availability_fixture_id"])
      .executeTakeFirst();

    if (!assignment) throwHttpError(404, "Assignment not found");

    await db
      .deleteFrom("availability_assignment")
      .where("id", "=", assignmentId)
      .execute();

    return { success: true };
  };
}

export function setAvailability(db: Kysely<DB>) {
  return async (
    userId: string,
    requestId: string,
    date: string,
    memberId: string,
    data: SetAvailability,
  ) => {
    const fixture = await db
      .selectFrom("availability_fixture")
      .where("availability_request_id", "=", requestId)
      .where("match_date", "=", date)
      .select("id")
      .executeTakeFirst();

    if (!fixture)
      throwHttpError(404, "No fixtures on this date for this request");

    const member = await db
      .selectFrom("member")
      .where("id", "=", memberId)
      .where("deleted_at", "is", null)
      .select("id")
      .executeTakeFirst();

    if (!member) throwHttpError(404, "Member not found");

    const now = new Date().toISOString();

    await db
      .insertInto("availability_response")
      .values({
        id: crypto.randomUUID(),
        availability_request_id: requestId,
        member_id: memberId,
        match_date: date,
        status: data.status,
        overridden_by: userId,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc
          .columns(["availability_request_id", "member_id", "match_date"])
          .doUpdateSet({
            status: data.status,
            overridden_by: userId,
            updated_at: now,
          }),
      )
      .execute();

    return { success: true };
  };
}

/**
 * Materialise matchday + matchday_player rows for one availability_fixture
 * from its current assignments. Fixtures with zero assignments are
 * skipped (no team to confirm).
 *
 * `onExisting` controls behaviour when a non-cancelled matchday already
 * exists for the (team, date) pair: "skip" returns the existing id (for
 * the auto-close flow, which iterates every fixture and should be a
 * no-op for the ones already handled), "conflict" throws 409 (for the
 * captain-triggered per-date confirm route, where re-confirming would
 * silently miss any assignments added since the matchday was created).
 */
async function materialiseFixtureMatchday(
  trx: Kysely<DB>,
  userId: string,
  fixture: {
    id: string;
    play_cricket_team_id: string;
    play_cricket_match_id: string;
    match_date: string;
    opposition: string;
    competition_type: string | null;
  },
  onExisting: "skip" | "conflict",
): Promise<{ matchdayId: string; created: boolean } | null> {
  const assignments = await trx
    .selectFrom("availability_assignment")
    .where("availability_fixture_id", "=", fixture.id)
    .selectAll()
    .orderBy("position", "asc")
    .execute();

  if (assignments.length === 0) return null;

  const existing = await trx
    .selectFrom("matchday")
    .where("play_cricket_team_id", "=", fixture.play_cricket_team_id)
    .where("match_date", "=", fixture.match_date)
    .where("status", "!=", "cancelled")
    .select("id")
    .executeTakeFirst();

  if (existing) {
    if (onExisting === "conflict") {
      throwHttpError(
        409,
        `A matchday already exists for ${fixture.opposition} on ${fixture.match_date}`,
      );
    }
    return { matchdayId: existing.id, created: false };
  }

  const matchdayId = crypto.randomUUID();
  await trx
    .insertInto("matchday")
    .values({
      id: matchdayId,
      play_cricket_team_id: fixture.play_cricket_team_id,
      match_date: fixture.match_date,
      opposition: fixture.opposition,
      competition_type: fixture.competition_type,
      play_cricket_match_id: fixture.play_cricket_match_id,
      status: "pending",
      created_by: userId,
    })
    .execute();

  await trx
    .insertInto("matchday_player")
    .values(
      assignments.map((a) => ({
        id: crypto.randomUUID(),
        matchday_id: matchdayId,
        member_id: a.member_id,
        player_name: a.player_name,
        status: "selected" as const,
      })),
    )
    .execute();

  return { matchdayId, created: true };
}

export function confirmDate(db: Kysely<DB>) {
  return async (userId: string, requestId: string, date: string) => {
    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .select(["id", "status"])
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    const fixtures = await db
      .selectFrom("availability_fixture")
      .where("availability_request_id", "=", requestId)
      .where("match_date", "=", date)
      .selectAll()
      .execute();

    if (fixtures.length === 0) {
      throwHttpError(404, "No fixtures found for this date");
    }

    const matchdayIds: Array<{ fixtureId: string; matchdayId: string }> = [];

    await db.transaction().execute(async (trx) => {
      for (const fixture of fixtures) {
        const result = await materialiseFixtureMatchday(
          trx,
          userId,
          fixture,
          "conflict",
        );
        if (result) {
          matchdayIds.push({
            fixtureId: fixture.id,
            matchdayId: result.matchdayId,
          });
        }
      }
    });

    return { matchdays: matchdayIds };
  };
}

/**
 * Confirm a single fixture's team into a matchday, leaving the rest of
 * the availability request open. This is the path that lets officials
 * lock in an earlier game while later games in the same multi-day
 * request keep collecting responses. Re-confirming an already-confirmed
 * fixture throws 409 (per `materialiseFixtureMatchday`'s "conflict"
 * mode) so picks added after the matchday exists aren't silently
 * dropped - manage those on the matchday squad screen instead.
 */
export function confirmFixture(db: Kysely<DB>) {
  return async (
    userId: string,
    requestId: string,
    date: string,
    fixtureId: string,
  ) => {
    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .select(["id"])
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    const fixture = await db
      .selectFrom("availability_fixture")
      .where("id", "=", fixtureId)
      .where("availability_request_id", "=", requestId)
      .where("match_date", "=", date)
      .selectAll()
      .executeTakeFirst();

    if (!fixture) {
      throwHttpError(404, "Fixture not found for this request and date");
    }

    const result = await db
      .transaction()
      .execute((trx) =>
        materialiseFixtureMatchday(trx, userId, fixture, "conflict"),
      );

    if (!result) {
      throwHttpError(400, "No players are assigned to this fixture yet");
    }

    return { matchdayId: result.matchdayId };
  };
}

export function updateRequestStatus(db: Kysely<DB>) {
  return async (
    userId: string,
    requestId: string,
    data: UpdateRequestStatus,
  ) => {
    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .select(["id", "status"])
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    // The open->closed transition is what turns picks into matchdays:
    // we materialise one matchday per fixture-with-assignments, skipping
    // any fixture whose (team, date) already has a non-cancelled
    // matchday so re-closing after a re-open is a no-op. Closing an
    // already-closed request is a status-set with no materialisation.
    const shouldMaterialise =
      data.status === "closed" && request.status !== "closed";
    let matchdaysCreated = 0;
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("availability_request")
        .set({ status: data.status })
        .where("id", "=", requestId)
        .execute();

      if (!shouldMaterialise) return;

      const fixtures = await trx
        .selectFrom("availability_fixture")
        .where("availability_request_id", "=", requestId)
        .selectAll()
        .execute();

      for (const fixture of fixtures) {
        const result = await materialiseFixtureMatchday(
          trx,
          userId,
          fixture,
          "skip",
        );
        if (result?.created) matchdaysCreated += 1;
      }
    });

    return { success: true, matchdaysCreated };
  };
}

// ── Member Services ──

export function getActiveRequests(db: Kysely<DB>) {
  return async (memberEmail: string) => {
    // Find member by email
    const member = await db
      .selectFrom("member")
      .where("email", "=", memberEmail)
      .where("deleted_at", "is", null)
      .select("id")
      .executeTakeFirst();

    // Every request is now scoped to one or more user groups (no
    // implicit club-wide case). A member sees a request if they are a
    // member of any of its groups; users with no member record see
    // nothing here.
    if (!member) {
      return { memberId: null, items: [] };
    }

    const requests = await db
      .selectFrom("availability_request")
      .where("status", "=", "open")
      .where("id", "in", (eb) =>
        eb
          .selectFrom("availability_request_group")
          .select("request_id")
          .where("user_group_id", "in", (sub) =>
            sub
              .selectFrom("user_group_member")
              .select("group_id")
              .where("member_id", "=", member.id),
          ),
      )
      .selectAll()
      .orderBy("date_from", "asc")
      .execute();

    if (requests.length === 0) {
      return { memberId: member?.id ?? null, items: [] };
    }

    const requestIds = requests.map((r) => r.id);

    // Get fixtures per request
    const fixtures = await db
      .selectFrom("availability_fixture")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "availability_fixture.play_cricket_team_id",
      )
      .where("availability_fixture.availability_request_id", "in", requestIds)
      .select([
        "availability_fixture.id",
        "availability_fixture.availability_request_id",
        "availability_fixture.match_date",
        "availability_fixture.play_cricket_team_id",
        "availability_fixture.play_cricket_match_id",
        "availability_fixture.opposition",
        "availability_fixture.is_home",
        "availability_fixture.competition_name",
        "availability_fixture.match_time",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("availability_fixture.match_date", "asc")
      .execute();

    // Get member's existing responses
    let myResponses: Array<{
      availability_request_id: string;
      match_date: string;
      status: string;
      note: string | null;
      id: string;
    }> = [];

    if (member) {
      myResponses = await db
        .selectFrom("availability_response")
        .where("availability_request_id", "in", requestIds)
        .where("member_id", "=", member.id)
        .select([
          "id",
          "availability_request_id",
          "match_date",
          "status",
          "note",
        ])
        .execute();
    }

    const today = new Date().toISOString().split("T")[0];
    const activeFixtures = fixtures.filter((f) => f.match_date >= today);

    // Count "available" responses per (request, date) so the response
    // and review screens can show "N players are available so far".
    // Scoped to today+ so we match the active-fixtures filter and don't
    // ship counts for past dates the UI can't display.
    const availableRows = await db
      .selectFrom("availability_response")
      .where("availability_request_id", "in", requestIds)
      .where("status", "=", "available")
      .where("match_date", ">=", today)
      .groupBy(["availability_request_id", "match_date"])
      .select([
        "availability_request_id",
        "match_date",
        db.fn.countAll<string>().as("count"),
      ])
      .execute();

    const fixturesByRequest = new Map<string, typeof fixtures>();
    for (const f of activeFixtures) {
      const list = fixturesByRequest.get(f.availability_request_id) ?? [];
      list.push(f);
      fixturesByRequest.set(f.availability_request_id, list);
    }

    const responsesByRequest = new Map<string, typeof myResponses>();
    for (const r of myResponses) {
      const list = responsesByRequest.get(r.availability_request_id) ?? [];
      list.push(r);
      responsesByRequest.set(r.availability_request_id, list);
    }

    const availableCountsByRequest = new Map<
      string,
      Array<{ match_date: string; count: number }>
    >();
    for (const r of availableRows) {
      const list =
        availableCountsByRequest.get(r.availability_request_id) ?? [];
      list.push({ match_date: r.match_date, count: Number(r.count) });
      availableCountsByRequest.set(r.availability_request_id, list);
    }

    return {
      memberId: member?.id ?? null,
      items: requests.map((r) => ({
        ...r,
        fixtures: fixturesByRequest.get(r.id) ?? [],
        myResponses: responsesByRequest.get(r.id) ?? [],
        availableCounts: availableCountsByRequest.get(r.id) ?? [],
      })),
    };
  };
}

export function respond(db: Kysely<DB>) {
  return async (memberEmail: string, requestId: string, data: Respond) => {
    // Find member by email
    const member = await db
      .selectFrom("member")
      .where("email", "=", memberEmail)
      .where("deleted_at", "is", null)
      .select("id")
      .executeTakeFirst();

    if (!member) throwHttpError(404, "Member record not found");

    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .where("status", "=", "open")
      .select("id")
      .executeTakeFirst();

    if (!request) {
      throwHttpError(404, "Availability request not found or is closed");
    }

    // Validate all dates have fixtures in this request
    const fixtureDates = await db
      .selectFrom("availability_fixture")
      .where("availability_request_id", "=", requestId)
      .select("match_date")
      .distinct()
      .execute();

    const validDates = new Set(fixtureDates.map((f) => f.match_date));
    for (const r of data.responses) {
      if (!validDates.has(r.matchDate)) {
        throwHttpError(400, `No fixtures on ${r.matchDate} for this request`);
      }
    }

    const now = new Date().toISOString();

    // Upsert responses
    for (const r of data.responses) {
      await db
        .insertInto("availability_response")
        .values({
          id: crypto.randomUUID(),
          availability_request_id: requestId,
          member_id: member.id,
          match_date: r.matchDate,
          status: r.status,
          note: r.note ?? null,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc
            .columns(["availability_request_id", "member_id", "match_date"])
            .doUpdateSet({
              status: r.status,
              note: r.note ?? null,
              overridden_by: null,
              updated_at: now,
            }),
        )
        .execute();
    }

    return { success: true };
  };
}

// ── Preview (for request creation form) ──

export function previewFixtures(
  db: Kysely<DB>,
  playCricketApi: PlayCricketApiClient,
  siteId: string,
) {
  return async (dateFrom: string, dateTo: string) => {
    // Fetch senior team IDs
    const seniorTeams = await db
      .selectFrom("play_cricket_team")
      .where("is_junior", "=", false)
      .select(["id", "name"])
      .execute();

    const seniorTeamMap = new Map(seniorTeams.map((t) => [t.id, t.name]));

    const currentYear = new Date().getFullYear();
    const fromYear = parseInt(dateFrom.slice(0, 4), 10);
    const toYear = parseInt(dateTo.slice(0, 4), 10);
    const seasons = [
      ...new Set([fromYear, toYear, currentYear].filter((y) => y > 0)),
    ];

    const summaries = await Promise.all(
      seasons.map((season) => playCricketApi.getMatchesSummary(season)),
    );
    const allMatches = summaries.flatMap((s) => s.matches);

    const fixtures = allMatches
      .filter((m) => {
        const isoDate = pcDateToIso(m.match_date);
        if (isoDate < dateFrom || isoDate > dateTo) return false;

        const isHome = m.home_club_id === siteId;
        const isAway = m.away_club_id === siteId;
        if (!isHome && !isAway) return false;

        const ourTeamId = isHome ? m.home_team_id : m.away_team_id;
        return seniorTeamMap.has(ourTeamId);
      })
      .map((m) => {
        const isHome = m.home_club_id === siteId;
        const ourTeamId = isHome ? m.home_team_id : m.away_team_id;
        return {
          matchDate: pcDateToIso(m.match_date),
          playCricketMatchId: m.id.toString(),
          teamName: seniorTeamMap.get(ourTeamId) ?? "Unknown",
          opposition: isHome
            ? `${m.away_club_name} ${m.away_team_name}`
            : `${m.home_club_name} ${m.home_team_name}`,
          isHome,
          competitionName: m.competition_name ?? null,
          matchTime: m.match_time ?? null,
        };
      })
      .sort((a, b) => a.matchDate.localeCompare(b.matchDate));

    return { fixtures };
  };
}

// ── Notification Services ──

export function sendAvailabilityNotification(
  db: Kysely<DB>,
  sendEmail: SendEmail,
  sendPush: SendPush,
  baseUrl: string,
) {
  const fetchPrefs = getNotificationPreferencesByUserIds(db);
  const fetchPushSubs = listPushSubscriptionsForUsers(db);
  const pruneSubscription = deletePushSubscriptionByEndpoint(db);

  return async (
    requestId: string,
    data: NotifySend,
    log: FastifyBaseLogger,
  ) => {
    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .select(["id", "date_from", "date_to"])
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    const fixtureResult = await db
      .selectFrom("availability_fixture")
      .where("availability_request_id", "=", requestId)
      .select(db.fn.countAll<string>().as("count"))
      .executeTakeFirst();

    const fixtureCount = Number(fixtureResult?.count ?? 0);
    const imageBaseUrl = `${baseUrl}/images`;
    const url = `${baseUrl}/availability/${requestId}`;

    // Resolve user ids for the recipient emails so we can apply each
    // recipient's matchday_channel preference. Recipients without a
    // matching user (additional emails added by an admin) have no
    // preferences and no push subscriptions - fall back to email-only,
    // which is what they got pre-#379.
    const recipientEmails = data.recipients.map((r) => r.email.toLowerCase());
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

    let sent = 0;
    const failures: Array<{ email: string; reason: string }> = [];

    const sendOneEmail = async (recipient: {
      email: string;
      name: string | null;
    }): Promise<{ ok: true } | { ok: false; reason: string }> => {
      try {
        const html = await render(
          createElement(AvailabilityRequest.component, {
            imageBaseUrl,
            name: recipient.name,
            dateFrom: request.date_from,
            dateTo: request.date_to,
            fixtureCount,
            url,
          }),
        );
        await sendEmail({
          to: recipient.email,
          subject: AvailabilityRequest.subject,
          html,
        });
        return { ok: true };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn(
          {
            err,
            requestId,
            recipientEmail: recipient.email,
            channel: "email",
          },
          "availability_notification_failed",
        );
        return { ok: false, reason };
      }
    };

    for (const recipient of data.recipients) {
      const userId = userIdByEmail.get(recipient.email.toLowerCase());
      const channel: MatchdayChannel = userId
        ? (prefs.get(userId) ?? DEFAULT_MATCHDAY_CHANNEL)
        : "email";

      const wantsEmail = channel === "email" || channel === "both";
      const wantsPush = channel === "push" || channel === "both";

      // A push-only user with no live subscriptions falls back to email
      // so they don't silently miss the notification - subscribing is
      // opt-in and we can't tell from the prefs alone whether they
      // expect a push or simply haven't enabled it on any device yet.
      const subscriptions = userId ? (pushSubsByUser.get(userId) ?? []) : [];
      const pushAvailable = wantsPush && subscriptions.length > 0;

      let deliveredAny = false;
      let recipientFailure: string | null = null;

      if (wantsEmail || (wantsPush && !pushAvailable)) {
        const result = await sendOneEmail(recipient);
        if (result.ok) {
          deliveredAny = true;
        } else {
          recipientFailure = result.reason;
        }
      }

      if (pushAvailable) {
        const payload = {
          title: AvailabilityRequest.subject,
          body: `${fixtureCount} fixture${fixtureCount === 1 ? "" : "s"} ${request.date_from} - ${request.date_to}`,
          url,
          tag: `availability:${requestId}`,
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
              { requestId, endpoint: result.endpoint },
              "push_subscription_gone_pruned",
            );
          } else {
            allGone = false;
            log.warn(
              {
                requestId,
                recipientEmail: recipient.email,
                endpoint: result.endpoint,
                reason: result.reason,
                channel: "push",
              },
              "availability_notification_failed",
            );
            recipientFailure ??= result.reason;
          }
        }

        // Push-only recipient whose every subscription was pruned this
        // turn - they look "subscribed" in our store but the push service
        // disagrees. Treat it the same as the "no subscriptions" branch
        // above and email them so they don't silently miss the notice.
        if (!wantsEmail && !pushDelivered && allGone) {
          const fallback = await sendOneEmail(recipient);
          if (fallback.ok) {
            deliveredAny = true;
            recipientFailure = null;
          } else {
            recipientFailure ??= fallback.reason;
          }
        }
      }

      if (deliveredAny) {
        sent++;
      } else {
        failures.push({
          email: recipient.email,
          reason: recipientFailure ?? "no delivery channel",
        });
      }
    }

    if (failures.length > 0) {
      log.warn(
        {
          requestId,
          failureCount: failures.length,
          totalCount: data.recipients.length,
        },
        "availability_notification_partial",
      );
    }

    return { sent, failed: failures.length, failures };
  };
}

// ── Public Request ──

export function getPublicRequest(db: Kysely<DB>) {
  return async (requestId: string) => {
    const request = await db
      .selectFrom("availability_request")
      .where("id", "=", requestId)
      .where("status", "=", "open")
      .select(["id", "date_from", "date_to", "status"])
      .executeTakeFirst();

    if (!request) throwHttpError(404, "Availability request not found");

    const fixtures = await db
      .selectFrom("availability_fixture")
      .leftJoin(
        "play_cricket_team",
        "play_cricket_team.id",
        "availability_fixture.play_cricket_team_id",
      )
      .where("availability_fixture.availability_request_id", "=", requestId)
      .select([
        "availability_fixture.id",
        "availability_fixture.availability_request_id",
        "availability_fixture.match_date",
        "availability_fixture.play_cricket_team_id",
        "availability_fixture.play_cricket_match_id",
        "availability_fixture.opposition",
        "availability_fixture.is_home",
        "availability_fixture.competition_name",
        "availability_fixture.match_time",
        "play_cricket_team.name as team_name",
      ])
      .orderBy("availability_fixture.match_date", "asc")
      .execute();

    return { request, fixtures };
  };
}
