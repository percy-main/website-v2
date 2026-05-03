import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { createScoutCache } from "./cache.ts";

function makeDbStub(opts: { hit?: { payload: unknown } }) {
  const onConflictDoUpdateExecute = vi.fn().mockResolvedValue(undefined);
  const insertExecute = vi.fn().mockResolvedValue(undefined);

  const builder = {
    selectFrom: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(opts.hit ?? undefined),
    insertInto: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockImplementation((cb: (oc: unknown) => unknown) => {
      // Mimic Kysely's onConflict callback API: it returns a builder with
      // .execute(). We swallow the callback's intermediate calls and return
      // a builder that resolves on .execute().
      cb({
        column: () => ({ doUpdateSet: () => ({}) }),
      });
      return { execute: insertExecute };
    }),
    execute: onConflictDoUpdateExecute,
  };

  return builder as unknown as Kysely<DB>;
}

describe("scout cache", () => {
  it("returns the cached payload on hit without invoking the fetcher", async () => {
    const db = makeDbStub({ hit: { payload: { hello: "world" } } });
    const cache = createScoutCache(db);
    const fetcher = vi.fn();

    const result = await cache.getOrSet("pc_list_teams", {}, 3600, fetcher);

    expect(result).toEqual({ hello: "world" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls the fetcher and writes through on miss", async () => {
    const db = makeDbStub({});
    const cache = createScoutCache(db);
    const fetcher = vi.fn().mockResolvedValue({ teams: [] });

    const result = await cache.getOrSet("pc_list_teams", {}, 3600, fetcher);

    expect(result).toEqual({ teams: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("derives the same cache key regardless of arg key order", async () => {
    const db1 = makeDbStub({});
    const db2 = makeDbStub({});
    const cache1 = createScoutCache(db1);
    const cache2 = createScoutCache(db2);

    const fetcher = vi.fn().mockResolvedValue("ok");

    await cache1.getOrSet("pc", { a: 1, b: 2 }, 60, fetcher);
    await cache2.getOrSet("pc", { b: 2, a: 1 }, 60, fetcher);

    // Both cache writes go through the same insertInto -> values path.
    // The cache_key passed to .values() should match between the two calls.
    const keys: string[] = [];
    for (const db of [db1, db2]) {
      const dbAny = db as unknown as {
        values: ReturnType<typeof vi.fn>;
      };
      const lastCall = dbAny.values.mock.calls.at(-1);
      keys.push((lastCall?.[0] as { cache_key: string }).cache_key);
    }
    expect(keys[0]).toBe(keys[1]);
  });
});
