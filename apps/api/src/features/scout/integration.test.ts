import type { DB } from "@percy-main/db";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedTestUser,
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";
import {
  appendMessage,
  assertThreadOwnership,
  createThread,
  deleteThread,
  getThread,
  listThreads,
  ThreadNotFoundError,
} from "./service.ts";
import { createScoutCache } from "./tools/cache.ts";
import { createDbTools } from "./tools/db.ts";
import { createPlayCricketTools } from "./tools/play-cricket.ts";

let ctx: TestContext;
let scoutDb: Kysely<DB>;
let scoutPool: pg.Pool;

beforeAll(async () => {
  ctx = await startTestContainer();

  // Migrations created scout_readonly NOLOGIN with no password — the same
  // way it lands in prod. Tests need to actually connect as that role, so
  // grant LOGIN + a password here. Mirrors what the dev/Terraform setup
  // does out-of-band.
  await sql`ALTER ROLE scout_readonly WITH LOGIN PASSWORD 'integration_test_pwd'`.execute(
    ctx.db,
  );

  // Build a connection string for scout_readonly against the same DB.
  const url = new URL(ctx.connectionString);
  url.username = "scout_readonly";
  url.password = "integration_test_pwd";
  scoutPool = new pg.Pool({ connectionString: url.toString(), max: 3 });
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- swallow shutdown noise
  scoutPool.on("error", () => {});
  scoutDb = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: scoutPool }),
  });
}, 60_000);

afterAll(async () => {
  // scoutDb.destroy() ends scoutPool internally — calling pool.end() again
  // would throw "Called end on pool more than once".
  await scoutDb.destroy();
  await stopTestContainer(ctx);
});

const opts = {
  toolCallId: "t",
  messages: [],
  abortSignal: undefined,
} as never;

describe("scout_readonly role boundary (security-critical)", () => {
  it("can SELECT from the scout_member view", async () => {
    const out = await sql<{
      count: string;
    }>`SELECT count(*) FROM scout_member`.execute(scoutDb);
    expect(out.rows).toHaveLength(1);
  });

  it("can SELECT from allowlisted matchday table", async () => {
    const out = await sql<{
      count: string;
    }>`SELECT count(*) FROM matchday`.execute(scoutDb);
    expect(out.rows).toHaveLength(1);
  });

  it("CANNOT SELECT from user table (sensitive)", async () => {
    await expect(
      sql`SELECT email FROM "user" LIMIT 1`.execute(scoutDb),
    ).rejects.toThrow(/permission denied|relation .* does not exist/i);
  });

  it("CANNOT SELECT from member table directly (only via scout_member view)", async () => {
    await expect(
      sql`SELECT * FROM member LIMIT 1`.execute(scoutDb),
    ).rejects.toThrow(/permission denied|relation .* does not exist/i);
  });

  it("CANNOT SELECT from charge table", async () => {
    await expect(
      sql`SELECT * FROM charge LIMIT 1`.execute(scoutDb),
    ).rejects.toThrow(/permission denied|relation .* does not exist/i);
  });

  it("CANNOT INSERT into matchday (read-only on allowed tables)", async () => {
    await expect(
      sql`INSERT INTO matchday (id, match_date) VALUES (gen_random_uuid(), '2025-06-01')`.execute(
        scoutDb,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("CANNOT UPDATE matchday", async () => {
    await expect(
      sql`UPDATE matchday SET match_date = '2025-06-01'`.execute(scoutDb),
    ).rejects.toThrow(/permission denied/i);
  });

  it("CANNOT DELETE from matchday", async () => {
    await expect(sql`DELETE FROM matchday`.execute(scoutDb)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe("db_run_sql tool against the readonly role (defence-in-depth)", () => {
  const tools = () => createDbTools({ dbReadonly: scoutDb });

  it("rejects write SQL even though the role would also reject it", async () => {
    const t = tools();
    const result = await t.db_run_sql.execute!(
      { query: "INSERT INTO matchday (id) VALUES (gen_random_uuid())" },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("must start with SELECT or WITH"),
    });
  });

  it("an attempt to run a write that bypasses the regex check still fails", async () => {
    const t = tools();
    const result = await t.db_run_sql.execute!(
      // Wrap a write inside a CTE — passes the SELECT/WITH prefix check.
      // Three independent layers all reject this: (1) Postgres refuses a
      // data-modifying CTE inside our `SELECT * FROM (…) _scout_q` wrapper,
      // (2) the readonly role lacks DELETE grants on matchday, (3) the
      // transaction sets transaction_read_only = on. Belt + braces +
      // suspenders.
      {
        query: "WITH x AS (DELETE FROM matchday RETURNING id) SELECT * FROM x",
      },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringMatching(
        /permission denied|syntax|read-only|data-modifying/i,
      ),
    });
  });

  it("returns rows for a real SELECT against scout_member", async () => {
    const t = tools();
    const result = (await t.db_run_sql.execute!(
      { query: "SELECT count(*)::int AS n FROM scout_member" },
      opts,
    )) as unknown as {
      rows: Array<{ n: number }>;
      rowCount: number;
      truncated: boolean;
    };
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n).toBeGreaterThanOrEqual(0);
    expect(result.truncated).toBe(false);
  });

  it("flags truncated when a query exceeds the row cap", async () => {
    const t = tools();
    const result = (await t.db_run_sql.execute!(
      { query: "SELECT * FROM generate_series(1, 1000) AS g(n)" },
      opts,
    )) as unknown as { rowCount: number; truncated: boolean };
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(500);
  });

  it("db_describe_table works against the readonly role", async () => {
    const t = tools();
    const result = (await t.db_describe_table.execute!(
      { table: "scout_member" },
      opts,
    )) as unknown as { name: string; columns: Array<{ name: string }> };
    expect(result.name).toBe("scout_member");
    const columnNames = result.columns.map((c) => c.name);
    expect(columnNames).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "dob",
        "member_category",
        "slug",
        "play_cricket_id",
      ]),
    );
    // Make sure we did NOT leak fields the view excludes
    expect(columnNames).not.toContain("email");
    expect(columnNames).not.toContain("phone");
    expect(columnNames).not.toContain("address");
  });
});

describe("scout cache (integration)", () => {
  it("writes through to scout_tool_cache and reads back", async () => {
    const cache = createScoutCache(ctx.db);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { value: "fresh" };
    };

    const first = await cache.getOrSet("itest", { k: 1 }, 60, fetcher);
    const second = await cache.getOrSet("itest", { k: 1 }, 60, fetcher);

    expect(first).toEqual({ value: "fresh" });
    expect(second).toEqual({ value: "fresh" });
    expect(calls).toBe(1);
  });

  it("re-fetches when the cached entry has expired", async () => {
    const cache = createScoutCache(ctx.db);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { call: calls };
    };

    // Insert with a TTL of 0 → expired immediately
    await cache.getOrSet("itest-expiring", {}, 0, fetcher);
    const second = await cache.getOrSet("itest-expiring", {}, 60, fetcher);

    expect(second).toEqual({ call: 2 });
    expect(calls).toBe(2);
  });
});

describe("scout thread service (integration)", () => {
  it("creates, lists, gets, and deletes a thread", async () => {
    const { userId } = await seedTestUser(ctx.db, {
      withMember: false,
    });

    const create = createThread(ctx.db);
    const list = listThreads(ctx.db);
    const get = getThread(ctx.db);
    const append = appendMessage(ctx.db);
    const remove = deleteThread(ctx.db);

    const t1 = await create(userId, "Scouting Newcastle CC");
    const t2 = await create(userId, "Bowling plan vs Tynemouth");

    const threads = await list(userId);
    expect(threads).toHaveLength(2);
    // Most recently updated first
    expect(threads[0].id).toBe(t2.id);

    await append(t1.id, "user", [{ type: "text", text: "Hi Scout" }]);
    await append(t1.id, "assistant", [
      { type: "text", text: "Hi captain — what do you need?" },
    ]);

    const loaded = await get(userId, t1.id);
    expect(loaded.thread.id).toBe(t1.id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].role).toBe("user");
    expect(loaded.messages[1].role).toBe("assistant");

    await remove(userId, t1.id);
    const remaining = await list(userId);
    expect(remaining.map((t) => t.id)).toEqual([t2.id]);
  });

  it("refuses to read or delete another user's thread", async () => {
    const { userId: alice } = await seedTestUser(ctx.db, { withMember: false });
    const { userId: bob } = await seedTestUser(ctx.db, { withMember: false });

    const create = createThread(ctx.db);
    const get = getThread(ctx.db);
    const remove = deleteThread(ctx.db);
    const assertOwned = assertThreadOwnership(ctx.db);

    const aliceThread = await create(alice, "Mine");

    await expect(get(bob, aliceThread.id)).rejects.toBeInstanceOf(
      ThreadNotFoundError,
    );
    await expect(remove(bob, aliceThread.id)).rejects.toBeInstanceOf(
      ThreadNotFoundError,
    );
    await expect(assertOwned(bob, aliceThread.id)).rejects.toBeInstanceOf(
      ThreadNotFoundError,
    );

    // Alice can still access her own
    await expect(assertOwned(alice, aliceThread.id)).resolves.toBeUndefined();
  });
});

describe("Play Cricket tools (with stub client)", () => {
  it("calls the underlying client and caches by argument shape", async () => {
    const cache = createScoutCache(ctx.db);
    let calls = 0;
    const playCricket = {
      getTeams: async () => ({ teams: [] }),
      getPlayers: async () => {
        calls++;
        return { players: [{ member_id: 1, name: "Test Player" }] };
      },
      getMatchDetail: async () => ({}),
      getMatchesSummary: async () => ({ matches: [] }),
      getLeagueTable: async () => ({ league_table: [] }),
    } as never;

    const tools = createPlayCricketTools({ playCricket, cache });

    const a = await tools.pc_list_players.execute!({}, opts);
    const b = await tools.pc_list_players.execute!({}, opts);

    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });
});
