import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { createHash } from "node:crypto";

export interface ScoutCache {
  getOrSet: <T>(
    toolName: string,
    args: unknown,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ) => Promise<T>;
}

export function createScoutCache(db: Kysely<DB>): ScoutCache {
  return {
    async getOrSet(toolName, args, ttlSeconds, fetcher) {
      const cacheKey = computeCacheKey(toolName, args);

      const hit = await db
        .selectFrom("scout_tool_cache")
        .where("cache_key", "=", cacheKey)
        .where("expires_at", ">", new Date())
        .select(["payload"])
        .executeTakeFirst();

      if (hit) {
        return hit.payload as Awaited<ReturnType<typeof fetcher>>;
      }

      const payload = await fetcher();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      await db
        .insertInto("scout_tool_cache")
        .values({
          cache_key: cacheKey,
          tool_name: toolName,
          payload: JSON.stringify(payload),
          expires_at: expiresAt,
        })
        .onConflict((oc) =>
          oc.column("cache_key").doUpdateSet({
            tool_name: toolName,
            payload: JSON.stringify(payload),
            expires_at: expiresAt,
          }),
        )
        .execute();

      return payload;
    },
  };
}

function computeCacheKey(toolName: string, args: unknown): string {
  const canonical = canonicalize(args);
  const hash = createHash("sha256")
    .update(`${toolName}|${canonical}`)
    .digest("hex");
  return `${toolName}:${hash}`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}
