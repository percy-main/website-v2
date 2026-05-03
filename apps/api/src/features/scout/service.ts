import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";

export interface ThreadSummary {
  id: string;
  title: string;
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
      .select(["id", "title", "created_at", "updated_at"])
      .orderBy("updated_at", "desc")
      .execute();

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
  };
}

export function createThread(db: Kysely<DB>) {
  return async (userId: string, title: string): Promise<ThreadSummary> => {
    const row = await db
      .insertInto("scout_thread")
      .values({ user_id: userId, title })
      .returning(["id", "title", "created_at", "updated_at"])
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      title: row.title,
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
      .select(["id", "title", "created_at", "updated_at"])
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

/**
 * Verify a thread exists and is owned by the user. Used by the streaming
 * route, which can't use getThread (we don't want to load all messages just
 * to check ownership).
 */
export function assertThreadOwnership(db: Kysely<DB>) {
  return async (userId: string, threadId: string): Promise<void> => {
    const row = await db
      .selectFrom("scout_thread")
      .where("id", "=", threadId)
      .where("user_id", "=", userId)
      .select("id")
      .executeTakeFirst();
    if (!row) throw new ThreadNotFoundError();
  };
}
