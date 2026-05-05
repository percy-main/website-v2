import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import type { ScoutMode } from "./schemas.ts";

export interface ThreadSummary {
  id: string;
  title: string;
  mode: ScoutMode;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  parts: unknown[];
  createdAt: string;
}

export class ThreadNotFoundError extends Error {
  constructor() {
    super("Thread not found");
  }
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function listThreads(db: Kysely<DB>) {
  return async (userId: string): Promise<ThreadSummary[]> => {
    const rows = await db
      .selectFrom("scout_thread")
      .where("user_id", "=", userId)
      .select(["id", "title", "mode", "created_at", "updated_at"])
      .orderBy("updated_at", "desc")
      .execute();

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode as ScoutMode,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
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
    const thread = await db
      .selectFrom("scout_thread")
      .where("id", "=", threadId)
      .where("user_id", "=", userId)
      .select(["id", "title", "mode", "created_at", "updated_at"])
      .executeTakeFirst();

    if (!thread) throw new ThreadNotFoundError();

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
      },
      messages: messageRows.map((m) => ({
        id: m.id,
        role: m.role as PersistedMessage["role"],
        parts: Array.isArray(m.parts) ? (m.parts as unknown[]) : [m.parts],
        createdAt: toIso(m.created_at),
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
      })
      .returning(["id", "role", "parts", "created_at"])
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      role: row.role as PersistedMessage["role"],
      parts: Array.isArray(row.parts) ? (row.parts as unknown[]) : [row.parts],
      createdAt: toIso(row.created_at),
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
 * the debrief launcher. We match by team-name prefix because the local
 * MatchResult mirror doesn't carry club_ids — every Percy Main team
 * starts with "Percy Main" (e.g. "Percy Main 1st XI", "Percy Main 2nd XI").
 */
export function listRecentDebriefMatches(db: Kysely<DB>) {
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
        "result",
        "result_description",
      ])
      .where("match_date", ">=", cutoff)
      .where("match_date", "<=", today)
      .where((eb) =>
        eb.or([
          eb("home_team_name", "like", "Percy Main%"),
          eb("away_team_name", "like", "Percy Main%"),
        ]),
      )
      .orderBy("match_date", "desc")
      .execute();

    return rows.map((r) => {
      const isHome = r.home_team_name.startsWith("Percy Main");
      return {
        id: r.match_id,
        matchDate: r.match_date,
        opposition: isHome ? r.away_team_name : r.home_team_name,
        homeAway: isHome ? ("home" as const) : ("away" as const),
        ourTeam: isHome ? r.home_team_name : r.away_team_name,
        result: r.result_description || r.result || null,
      };
    });
  };
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
  phases?: Record<
    "researcher" | "analyst" | "render",
    {
      state: "pending" | "active" | "done" | "failed";
      startedAt?: number;
      endedAt?: number;
      summary?: { records?: number; claims?: number; bytes?: number };
    }
  >;
  recentToolCalls?: Array<{
    id: string;
    phase: "researcher" | "analyst" | "render";
    toolName: string;
    at: number;
  }>;
}

interface PersistedProgressShape {
  phases: ReportDetail["phases"];
  recentToolCalls: ReportDetail["recentToolCalls"];
}

const dbStatusToFeStatus = (status: string): ReportDetail["status"] => {
  if (status === "ready" || status === "failed" || status === "queued") {
    return status;
  }
  // researching / analysing / rendering all surface as 'generating'; the
  // phase JSONB carries the granular state for the pipeline card.
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
        "phases",
      ])
      .executeTakeFirst();
    if (!row) return null;

    // phases JSONB persists the worker's `{ phases, recentToolCalls }`
    // shape. Treat as opaque if it doesn't parse — the FE tolerates a
    // missing pipeline section.
    const progress =
      row.phases && typeof row.phases === "object" && !Array.isArray(row.phases)
        ? (row.phases as unknown as PersistedProgressShape)
        : null;

    return {
      reportId: row.id,
      title: row.title,
      fileSizeBytes: row.file_size_bytes,
      createdAt: toIso(row.created_at),
      status: dbStatusToFeStatus(row.status),
      errorMessage: row.error_message ?? undefined,
      startedAt: row.started_at ? row.started_at.getTime() : undefined,
      phases: progress?.phases,
      recentToolCalls: progress?.recentToolCalls,
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
