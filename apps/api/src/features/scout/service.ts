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
    mode: ScoutMode = "scouting",
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
