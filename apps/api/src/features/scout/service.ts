import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type { ScoutMode } from "./schemas.ts";

/**
 * Sharing actor identity used in API responses (the owner who shared,
 * or — on a list of sharees — the recipient). We only ever surface
 * what's needed to render "Shared by Alex" / "Shared with: Alex, Jo".
 */
export interface ShareActor {
  id: string;
  name: string;
  email: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  mode: ScoutMode;
  createdAt: string;
  updatedAt: string;
  /** When the current viewer is a recipient (not the owner), the owner
   * who shared the thread with them. Null on owned threads. */
  sharedBy: ShareActor | null;
  /** True when the current viewer owns the thread AND has shared it with
   * at least one other user. Lets the FE render a "shared" badge in the
   * list without an extra round-trip to count sharees. */
  sharedByMe: boolean;
}

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  parts: unknown[];
  createdAt: string;
  attachmentIds: string[];
}

export class ThreadNotFoundError extends Error {
  constructor() {
    super("Thread not found");
  }
}

export class ShareForbiddenError extends Error {
  constructor() {
    super("Only the thread owner can manage sharing");
  }
}

// Inherits Error's (message: string) constructor — service.ts callers do
// `throw new ShareInvalidRecipientError("…")` and route handlers re-throw
// with statusCode: 400 using err.message verbatim.
export class ShareInvalidRecipientError extends Error {}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function listThreads(db: Kysely<DB>) {
  return async (userId: string): Promise<ThreadSummary[]> => {
    // Three queries, then merge in JS:
    //   1. owned threads
    //   2. threads shared WITH me (recipient view)
    //   3. ids of owned threads I've shared with someone (so the list view
    //      can render a "shared" badge on my own row)
    // Doing it as one giant CTE+UNION+OUTER-JOIN was a tighter SQL but a
    // worse read; the row counts are tiny (a captain has tens of threads,
    // not thousands) so this is plenty fast.
    const ownedRows = await db
      .selectFrom("scout_thread")
      .where("user_id", "=", userId)
      .select(["id", "title", "mode", "created_at", "updated_at"])
      .orderBy("updated_at", "desc")
      .execute();

    const sharedRows = await db
      .selectFrom("scout_thread_share as s")
      .innerJoin("scout_thread as t", "t.id", "s.thread_id")
      .innerJoin("user as u", "u.id", "s.shared_by_user_id")
      .where("s.shared_with_user_id", "=", userId)
      .select([
        "t.id as id",
        "t.title as title",
        "t.mode as mode",
        "t.created_at as created_at",
        "t.updated_at as updated_at",
        "u.id as owner_id",
        "u.name as owner_name",
        "u.email as owner_email",
      ])
      .execute();

    const sharedByMeIds =
      ownedRows.length === 0
        ? new Set<string>()
        : new Set(
            (
              await db
                .selectFrom("scout_thread_share")
                .where(
                  "thread_id",
                  "in",
                  ownedRows.map((r) => r.id),
                )
                .select("thread_id")
                .distinct()
                .execute()
            ).map((r) => r.thread_id),
          );

    const owned: ThreadSummary[] = ownedRows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode as ScoutMode,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
      sharedBy: null,
      sharedByMe: sharedByMeIds.has(r.id),
    }));

    const shared: ThreadSummary[] = sharedRows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode as ScoutMode,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
      sharedBy: {
        id: r.owner_id,
        name: r.owner_name,
        email: r.owner_email,
      },
      sharedByMe: false,
    }));

    return [...owned, ...shared].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
  };
}

export function createThread(db: Kysely<DB>) {
  return async (
    userId: string,
    title: string,
    mode: ScoutMode = "chat",
  ): Promise<ThreadSummary> => {
    const row = await db
      .insertInto("scout_thread")
      .values({ user_id: userId, title, mode })
      .returning(["id", "title", "mode", "created_at", "updated_at"])
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      title: row.title,
      mode: row.mode as ScoutMode,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      sharedBy: null,
      sharedByMe: false,
    };
  };
}

export interface ThreadUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function getThread(db: Kysely<DB>) {
  return async (
    userId: string,
    threadId: string,
  ): Promise<{
    thread: ThreadSummary;
    messages: PersistedMessage[];
    usage: ThreadUsage;
  }> => {
    // Fetch the thread + owner identity, then check access against the
    // current viewer. Access = owner OR a row in scout_thread_share. We
    // do the access check after the row fetch (rather than embedding it
    // in WHERE) so a non-existent thread and a forbidden thread look
    // identical to the caller — both throw ThreadNotFoundError → 404.
    const thread = await db
      .selectFrom("scout_thread as t")
      .innerJoin("user as u", "u.id", "t.user_id")
      .where("t.id", "=", threadId)
      .select([
        "t.id",
        "t.user_id",
        "t.title",
        "t.mode",
        "t.created_at",
        "t.updated_at",
        "u.id as owner_id",
        "u.name as owner_name",
        "u.email as owner_email",
      ])
      .executeTakeFirst();

    if (!thread) throw new ThreadNotFoundError();

    const isOwner = thread.user_id === userId;
    if (!isOwner) {
      const share = await db
        .selectFrom("scout_thread_share")
        .where("thread_id", "=", threadId)
        .where("shared_with_user_id", "=", userId)
        .select("id")
        .executeTakeFirst();
      if (!share) throw new ThreadNotFoundError();
    }

    // Owner-side flag: have I shared this with anyone? Used by the FE
    // to render a small "shared" indicator next to the thread title.
    let sharedByMe = false;
    if (isOwner) {
      const any = await db
        .selectFrom("scout_thread_share")
        .where("thread_id", "=", threadId)
        .select("id")
        .executeTakeFirst();
      sharedByMe = !!any;
    }

    const messageRows = await db
      .selectFrom("scout_message")
      .where("thread_id", "=", threadId)
      .select([
        "id",
        "role",
        "parts",
        "created_at",
        "token_input",
        "token_output",
        "token_cache_read",
        "token_cache_creation",
        "attachment_ids",
      ])
      .orderBy("created_at", "asc")
      .execute();

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    for (const m of messageRows) {
      inputTokens += m.token_input ?? 0;
      outputTokens += m.token_output ?? 0;
      cacheReadTokens += m.token_cache_read ?? 0;
      cacheCreationTokens += m.token_cache_creation ?? 0;
    }

    return {
      thread: {
        id: thread.id,
        title: thread.title,
        mode: thread.mode as ScoutMode,
        createdAt: toIso(thread.created_at),
        updatedAt: toIso(thread.updated_at),
        sharedBy: isOwner
          ? null
          : {
              id: thread.owner_id,
              name: thread.owner_name,
              email: thread.owner_email,
            },
        sharedByMe,
      },
      messages: messageRows.map((m) => ({
        id: m.id,
        role: m.role as PersistedMessage["role"],
        parts: Array.isArray(m.parts) ? (m.parts as unknown[]) : [m.parts],
        createdAt: toIso(m.created_at),
        attachmentIds: m.attachment_ids ?? [],
      })),
      usage: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
      },
    };
  };
}

export function deleteThread(db: Kysely<DB>) {
  return async (userId: string, threadId: string): Promise<void> => {
    const result = await db
      .deleteFrom("scout_thread")
      .where("id", "=", threadId)
      .where("user_id", "=", userId)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      throw new ThreadNotFoundError();
    }
  };
}

export function appendMessage(db: Kysely<DB>) {
  return async (
    threadId: string,
    role: PersistedMessage["role"],
    parts: unknown[],
    tokens?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheCreation?: number;
    },
    attachmentIds?: string[],
  ): Promise<PersistedMessage> => {
    const row = await db
      .insertInto("scout_message")
      .values({
        thread_id: threadId,
        role,
        parts: JSON.stringify(parts),
        token_input: tokens?.input ?? null,
        token_output: tokens?.output ?? null,
        token_cache_read: tokens?.cacheRead ?? null,
        token_cache_creation: tokens?.cacheCreation ?? null,
        attachment_ids:
          attachmentIds && attachmentIds.length > 0 ? attachmentIds : null,
      })
      .returning(["id", "role", "parts", "created_at", "attachment_ids"])
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      role: row.role as PersistedMessage["role"],
      parts: Array.isArray(row.parts) ? row.parts : [row.parts],
      createdAt: toIso(row.created_at),
      attachmentIds: row.attachment_ids ?? [],
    };
  };
}

export function bumpThreadUpdatedAt(db: Kysely<DB>) {
  return async (threadId: string): Promise<void> => {
    await db
      .updateTable("scout_thread")
      .set({ updated_at: new Date() })
      .where("id", "=", threadId)
      .execute();
  };
}

export interface RecentDebriefMatch {
  id: string;
  matchDate: string;
  opposition: string;
  homeAway: "home" | "away";
  ourTeam: string;
  result: string | null;
}

/**
 * Recent Percy Main matches (last 14 days, descending) used to populate
 * the debrief launcher. Identified by club_id — Play Cricket stores
 * team names bare ("1st XI", "2nd XI") with no club prefix for either
 * side, so the only reliable disambiguator is club_id, persisted on
 * match_result by sync. Pre-migration rows have NULL club_ids and are
 * filtered out by the equality check; they fall out of the 14-day
 * window naturally.
 *
 * Display strings are "{club_name} {team_name}" so the launcher reads
 * "Percy Main 2nd XI vs Mitford 2nd XI" rather than the bare,
 * ambiguous "2nd XI vs 2nd XI" the API alone would produce.
 */
export function listRecentDebriefMatches(db: Kysely<DB>, siteId: string) {
  return async (
    days = 14,
    now: Date = new Date(),
  ): Promise<RecentDebriefMatch[]> => {
    const cutoff = new Date(now.getTime() - days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const rows = await db
      .selectFrom("match_result")
      .select([
        "match_id",
        "match_date",
        "home_team_name",
        "away_team_name",
        "home_club_id",
        "home_club_name",
        "away_club_id",
        "away_club_name",
        "result",
        "result_description",
      ])
      .where("match_date", ">=", cutoff)
      .where("match_date", "<=", today)
      .where((eb) =>
        eb.or([
          eb("home_club_id", "=", siteId),
          eb("away_club_id", "=", siteId),
        ]),
      )
      .orderBy("match_date", "desc")
      .execute();

    return rows.map((r) => {
      const isHome = r.home_club_id === siteId;
      const ourTeam = isHome
        ? joinClubAndTeam(r.home_club_name, r.home_team_name)
        : joinClubAndTeam(r.away_club_name, r.away_team_name);
      const opposition = isHome
        ? joinClubAndTeam(r.away_club_name, r.away_team_name)
        : joinClubAndTeam(r.home_club_name, r.home_team_name);
      return {
        id: r.match_id,
        matchDate: r.match_date,
        opposition,
        homeAway: isHome ? ("home" as const) : ("away" as const),
        ourTeam,
        result: r.result_description || r.result || null,
      };
    });
  };
}

// Defensive join — club_name is always written alongside club_id by sync,
// but if the API ever returns one without the other we don't want a
// stray "null 2nd XI" leaking to the FE.
function joinClubAndTeam(clubName: string | null, teamName: string): string {
  return clubName ? `${clubName} ${teamName}` : teamName;
}

export interface UpcomingScoutMatch {
  id: string;
  matchDate: string;
  matchTime: string | null;
  opposition: string;
  homeAway: "home" | "away";
  ourTeam: string;
  competition: string | null;
}

/**
 * Upcoming Percy Main fixtures (next `days` days, today inclusive, ascending)
 * used to populate the scout-mode launcher. Sourced from availability_fixture,
 * joined to play_cricket_team for the human-readable team name.
 *
 * Fixtures only land in availability_fixture once the captain creates an
 * availability request for them — that's the same lifecycle the existing
 * matchday flow assumes, so any fixture worth scouting is in this table.
 */
export function listUpcomingScoutMatches(db: Kysely<DB>) {
  return async (
    days = 14,
    now: Date = new Date(),
  ): Promise<UpcomingScoutMatch[]> => {
    const today = now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const rows = await db
      .selectFrom("availability_fixture as af")
      .innerJoin("play_cricket_team as t", "t.id", "af.play_cricket_team_id")
      .select([
        "af.play_cricket_match_id as match_id",
        "af.match_date",
        "af.match_time",
        "af.opposition",
        "af.is_home",
        "af.competition_name",
        "t.name as our_team",
      ])
      .where("af.match_date", ">=", today)
      .where("af.match_date", "<=", end)
      .orderBy("af.match_date", "asc")
      .orderBy("af.match_time", "asc")
      .execute();

    return rows.map((r) => ({
      id: r.match_id,
      matchDate: r.match_date,
      matchTime: r.match_time,
      opposition: r.opposition,
      homeAway: r.is_home ? "home" : "away",
      ourTeam: r.our_team,
      competition: r.competition_name,
    }));
  };
}

/**
 * Verify a thread exists and is owned by the user, returning its mode.
 * Used by the streaming route, which can't use getThread (we don't want
 * to load all messages just to check ownership) but does need the mode
 * to pick the right system prompt + tool surface.
 */
export function assertThreadOwnership(db: Kysely<DB>) {
  return async (
    userId: string,
    threadId: string,
  ): Promise<{ mode: ScoutMode }> => {
    const row = await db
      .selectFrom("scout_thread")
      .where("id", "=", threadId)
      .where("user_id", "=", userId)
      .select(["id", "mode"])
      .executeTakeFirst();
    if (!row) throw new ThreadNotFoundError();
    return { mode: row.mode as ScoutMode };
  };
}

// ── Reports ──

export interface ReportSummary {
  id: string;
  threadId: string;
  threadTitle: string | null;
  title: string;
  fileSizeBytes: number | null;
  createdAt: string;
  status: "queued" | "generating" | "ready" | "failed";
  /** Date.now() value when the worker started running. Null for queued
   *  rows; set as soon as the researcher phase begins. The FE uses this
   *  to render an elapsed-time indicator on in-flight rows. */
  startedAt: number | null;
}

export class ReportNotFoundError extends Error {
  constructor() {
    super("Report not found");
  }
}

export function listReports(db: Kysely<DB>) {
  return async (userId: string): Promise<ReportSummary[]> => {
    // Includes in-flight rows (queued / researching / analysing / rendering)
    // so the Reports tab can act as a recovery surface — click an in-flight
    // row to navigate back to its source thread, where the pipeline card
    // resumes from the row's live state. Failed rows stay hidden; the user
    // is expected to retry from chat rather than browse old failures.
    const rows = await db
      .selectFrom("scout_report as r")
      .leftJoin("scout_thread as t", "t.id", "r.thread_id")
      .where("r.user_id", "=", userId)
      .where("r.status", "!=", "failed")
      .select([
        "r.id",
        "r.thread_id",
        "t.title as thread_title",
        "r.title",
        "r.file_size_bytes",
        "r.created_at",
        "r.status",
        "r.started_at",
      ])
      .orderBy("r.created_at", "desc")
      .execute();

    return rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      threadTitle: r.thread_title ?? null,
      title: r.title,
      fileSizeBytes: r.file_size_bytes,
      createdAt: toIso(r.created_at),
      status: dbStatusToFeStatus(r.status),
      startedAt: r.started_at ? r.started_at.getTime() : null,
    }));
  };
}

export function getReportForDownload(db: Kysely<DB>) {
  return async (
    userId: string,
    reportId: string,
  ): Promise<{ s3Key: string; title: string }> => {
    const row = await db
      .selectFrom("scout_report")
      .where("id", "=", reportId)
      .where("user_id", "=", userId)
      .where("status", "=", "ready")
      .select(["s3_key", "title"])
      .executeTakeFirst();
    // Only ready rows have a non-null s3_key. The status filter above
    // guarantees that, but the column is nullable in the schema, so we
    // narrow with an explicit check to satisfy the return type.
    if (!row?.s3_key) throw new ReportNotFoundError();
    return { s3Key: row.s3_key, title: row.title };
  };
}

export function deleteReport(db: Kysely<DB>) {
  return async (
    userId: string,
    reportId: string,
  ): Promise<{ s3Key: string }> => {
    const row = await db
      .selectFrom("scout_report")
      .where("id", "=", reportId)
      .where("user_id", "=", userId)
      .where("status", "=", "ready")
      .select(["s3_key"])
      .executeTakeFirst();
    if (!row?.s3_key) throw new ReportNotFoundError();

    await db.deleteFrom("scout_report").where("id", "=", reportId).execute();
    return { s3Key: row.s3_key };
  };
}

export interface ReportDetail {
  reportId: string;
  title: string;
  fileSizeBytes: number | null;
  createdAt: string;
  status: "queued" | "generating" | "ready" | "failed";
  errorMessage?: string;
  startedAt?: number;
}

const dbStatusToFeStatus = (status: string): ReportDetail["status"] => {
  if (status === "ready" || status === "failed" || status === "queued") {
    return status;
  }
  // generating / rendering both surface as 'generating' to the FE — the
  // user just sees one loading box; the BE-side distinction is for ops/log
  // grepping only.
  return "generating";
};

export function getReportDetail(db: Kysely<DB>) {
  return async (
    userId: string,
    reportId: string,
  ): Promise<ReportDetail | null> => {
    const row = await db
      .selectFrom("scout_report")
      .where("id", "=", reportId)
      .where("user_id", "=", userId)
      .select([
        "id",
        "title",
        "file_size_bytes",
        "created_at",
        "status",
        "error_message",
        "started_at",
      ])
      .executeTakeFirst();
    if (!row) return null;

    return {
      reportId: row.id,
      title: row.title,
      fileSizeBytes: row.file_size_bytes,
      createdAt: toIso(row.created_at),
      status: dbStatusToFeStatus(row.status),
      errorMessage: row.error_message ?? undefined,
      startedAt: row.started_at ? row.started_at.getTime() : undefined,
    };
  };
}

export function cancelReport(db: Kysely<DB>) {
  return async (
    userId: string,
    reportId: string,
  ): Promise<{ alreadyComplete: boolean }> => {
    const row = await db
      .selectFrom("scout_report")
      .where("id", "=", reportId)
      .where("user_id", "=", userId)
      .select(["status"])
      .executeTakeFirst();
    if (!row) throw new ReportNotFoundError();
    if (row.status === "ready" || row.status === "failed") {
      return { alreadyComplete: true };
    }
    // Worker's flush picks this up at the next poll (≤1.5s) and aborts the
    // researcher loop; between-phase checks catch it for analyst/render.
    await db
      .updateTable("scout_report")
      .set({ cancel_requested: true })
      .where("id", "=", reportId)
      .execute();
    return { alreadyComplete: false };
  };
}

// ── Thread sharing ──
//
// v1 sharing model: an owner grants read-only access to one or more other
// admin/official users. Recipients can view the full thread (messages,
// charts, video embeds, reports) but cannot post — that's enforced by
// keeping every write path on `assertThreadOwnership`. "Branch my own
// thread" is the deferred follow-up if/when recipients want to continue
// the conversation in their own copy.

const SHAREABLE_ROLES = new Set(["admin", "official"]);

/**
 * Verify the current viewer owns the thread. Throws ThreadNotFoundError
 * if the thread doesn't exist; ShareForbiddenError if it exists but the
 * viewer isn't the owner. The two are split so the caller can map
 * 404 vs 403 in the route layer.
 */
async function assertOwnerForShare(
  db: Kysely<DB>,
  userId: string,
  threadId: string,
): Promise<void> {
  const row = await db
    .selectFrom("scout_thread")
    .where("id", "=", threadId)
    .select(["user_id"])
    .executeTakeFirst();
  if (!row) throw new ThreadNotFoundError();
  if (row.user_id !== userId) throw new ShareForbiddenError();
}

export function listOfficials(db: Kysely<DB>) {
  // Source for the share-modal picker: every admin / official EXCEPT the
  // current viewer (who'd never share with themselves — the unique-recipient
  // constraint also blocks it but we don't want them in the list).
  return async (currentUserId: string): Promise<ShareActor[]> => {
    const rows = await db
      .selectFrom("user")
      .where("role", "in", Array.from(SHAREABLE_ROLES))
      .where("id", "!=", currentUserId)
      .where((eb) =>
        eb.or([eb("banned", "is", null), eb("banned", "=", false)]),
      )
      .select(["id", "name", "email"])
      .orderBy("name", "asc")
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
  };
}

export function listSharees(db: Kysely<DB>) {
  return async (userId: string, threadId: string): Promise<ShareActor[]> => {
    await assertOwnerForShare(db, userId, threadId);
    const rows = await db
      .selectFrom("scout_thread_share as s")
      .innerJoin("user as u", "u.id", "s.shared_with_user_id")
      .where("s.thread_id", "=", threadId)
      .select(["u.id", "u.name", "u.email"])
      .orderBy("u.name", "asc")
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
  };
}

export function shareThread(db: Kysely<DB>) {
  return async (
    ownerUserId: string,
    threadId: string,
    recipientUserIds: string[],
  ): Promise<ShareActor[]> => {
    await assertOwnerForShare(db, ownerUserId, threadId);

    const unique = Array.from(new Set(recipientUserIds));
    if (unique.length === 0)
      return await listSharees(db)(ownerUserId, threadId);
    if (unique.includes(ownerUserId)) {
      throw new ShareInvalidRecipientError(
        "Cannot share a thread with yourself.",
      );
    }

    // Validate every recipient is still a real, role-eligible user. Doing
    // this here (rather than relying on the FK alone) lets us return a
    // useful 4xx instead of a Postgres-shaped error if someone bypassed
    // the picker; it also keeps the role rule colocated with the feature.
    const valid = await db
      .selectFrom("user")
      .where("id", "in", unique)
      .where("role", "in", Array.from(SHAREABLE_ROLES))
      .where((eb) =>
        eb.or([eb("banned", "is", null), eb("banned", "=", false)]),
      )
      .select(["id"])
      .execute();
    const validIds = new Set(valid.map((r) => r.id));
    const invalid = unique.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw new ShareInvalidRecipientError(
        `Recipient(s) not eligible for sharing: ${invalid.join(", ")}.`,
      );
    }

    // ON CONFLICT DO NOTHING on the unique (thread_id, shared_with_user_id)
    // constraint — resharing the same person is a silent no-op so the FE
    // can call this idempotently without checking what's already there.
    await db
      .insertInto("scout_thread_share")
      .values(
        unique.map((id) => ({
          thread_id: threadId,
          shared_by_user_id: ownerUserId,
          shared_with_user_id: id,
        })),
      )
      .onConflict((oc) =>
        oc.columns(["thread_id", "shared_with_user_id"]).doNothing(),
      )
      .execute();

    return await listSharees(db)(ownerUserId, threadId);
  };
}

export function unshareThread(db: Kysely<DB>) {
  return async (
    ownerUserId: string,
    threadId: string,
    recipientUserId: string,
  ): Promise<ShareActor[]> => {
    await assertOwnerForShare(db, ownerUserId, threadId);
    await db
      .deleteFrom("scout_thread_share")
      .where("thread_id", "=", threadId)
      .where("shared_with_user_id", "=", recipientUserId)
      .execute();
    return await listSharees(db)(ownerUserId, threadId);
  };
}
