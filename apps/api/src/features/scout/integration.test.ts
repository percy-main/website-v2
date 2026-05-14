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
  copyThread,
  createThread,
  deleteThread,
  getThread,
  listOfficials,
  listRecentDebriefMatches,
  listSharees,
  listThreads,
  ShareForbiddenError,
  ShareInvalidRecipientError,
  shareThread,
  ThreadNotFoundError,
  unshareThread,
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

/**
 * Run a Scout tool's execute fn in a test, asserting it's defined.
 * Centralises the type assertion so callers don't sprinkle `!` and
 * `as unknown as { ... }` casts that strict-type-checked eslint flags.
 */
async function runTool<T>(
  exec: ((input: never, opts: never) => unknown) | undefined,
  input: unknown,
): Promise<T> {
  if (!exec) throw new Error("tool has no execute");
  return (await exec(input as never, opts)) as T;
}

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
    const result = await runTool<{ error: string }>(t.db_run_sql.execute, {
      query: "INSERT INTO matchday (id) VALUES (gen_random_uuid())",
    });
    expect(result.error).toMatch(/must start with SELECT or WITH/);
  });

  it("a write wrapped in a CTE — which the prefix check waves through — still fails", async () => {
    const t = tools();
    // The SELECT/WITH prefix check is just a friendly hint to the agent;
    // it doesn't constitute a security boundary because a `WITH` can
    // contain a data-modifying CTE. The real boundary is the readonly
    // role's grants. Postgres also refuses a data-modifying CTE inside
    // our `SELECT * FROM (…) _scout_q` LIMIT wrapper, and we set
    // `transaction_read_only = on` for the session — but those are
    // belt-and-braces; the role grant is what makes this safe.
    const result = await runTool<{ error: string }>(t.db_run_sql.execute, {
      query: "WITH x AS (DELETE FROM matchday RETURNING id) SELECT * FROM x",
    });
    expect(result.error).toMatch(
      /permission denied|syntax|read-only|data-modifying/i,
    );
  });

  it("returns rows for a real SELECT against scout_member", async () => {
    const t = tools();
    const result = await runTool<{
      rows: Array<{ n: number }>;
      rowCount: number;
      truncated: boolean;
    }>(t.db_run_sql.execute, {
      query: "SELECT count(*)::int AS n FROM scout_member",
    });
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].n).toBeGreaterThanOrEqual(0);
    expect(result.truncated).toBe(false);
  });

  it("flags truncated when a query exceeds the row cap", async () => {
    const t = tools();
    const result = await runTool<{ rowCount: number; truncated: boolean }>(
      t.db_run_sql.execute,
      { query: "SELECT * FROM generate_series(1, 1000) AS g(n)" },
    );
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(500);
  });

  it("db_describe_table works against the readonly role", async () => {
    const t = tools();
    const result = await runTool<{
      name: string;
      columns: Array<{ name: string }>;
    }>(t.db_describe_table.execute, { table: "scout_member" });
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
    const fetcher = () => {
      calls++;
      return Promise.resolve({ value: "fresh" });
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
    const fetcher = () => {
      calls++;
      return Promise.resolve({ call: calls });
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

    // Alice can still access her own — assertThreadOwnership returns the
    // mode so the streaming route can pick the right system prompt.
    await expect(assertOwned(alice, aliceThread.id)).resolves.toEqual({
      mode: "chat",
    });
  });

  it("persists mode on thread creation and surfaces it via list / get / assertOwnership", async () => {
    const { userId } = await seedTestUser(ctx.db, { withMember: false });
    const create = createThread(ctx.db);
    const list = listThreads(ctx.db);
    const get = getThread(ctx.db);
    const assertOwned = assertThreadOwnership(ctx.db);

    const debrief = await create(userId, "Debrief vs Mitford", "debrief");
    const chat = await create(userId, "Free-form chat about Tynemouth");
    const scout = await create(userId, "Scout Tynemouth", "scout");

    expect(debrief.mode).toBe("debrief");
    expect(chat.mode).toBe("chat");
    expect(scout.mode).toBe("scout");

    const threads = await list(userId);
    expect(threads.find((t) => t.id === debrief.id)?.mode).toBe("debrief");
    expect(threads.find((t) => t.id === chat.id)?.mode).toBe("chat");
    expect(threads.find((t) => t.id === scout.id)?.mode).toBe("scout");

    const loaded = await get(userId, debrief.id);
    expect(loaded.thread.mode).toBe("debrief");

    await expect(assertOwned(userId, debrief.id)).resolves.toEqual({
      mode: "debrief",
    });
  });
});

describe("scout thread sharing (integration)", () => {
  it("listOfficials returns users with ai_chat:use excluding the current user, ordered by name", async () => {
    const { userId: viewer } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
      name: "Zara Owner",
    });
    const { userId: alice } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
      name: "Alice Chat",
    });
    const { userId: bob } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "admin",
      name: "Bob Admin",
    });
    // Plain user (no role) — must NOT appear in the picker.
    await seedTestUser(ctx.db, {
      withMember: false,
      role: null as unknown as string,
      name: "Charlie Civilian",
    });
    // Legacy `official` role — has matchday perms but NOT ai_chat:use, so
    // they should be excluded under the RBAC-based recipient rule.
    const { userId: dora } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "official",
      name: "Dora Official",
    });

    const officials = await listOfficials(ctx.db)(viewer);
    const ids = officials.map((o) => o.id);
    expect(ids).toContain(alice);
    expect(ids).toContain(bob);
    expect(ids).not.toContain(viewer);
    expect(ids).not.toContain(dora);
    // Alphabetical by name
    const aIdx = officials.findIndex((o) => o.id === alice);
    const bIdx = officials.findIndex((o) => o.id === bob);
    expect(aIdx).toBeLessThan(bIdx);
  });

  it("share + getThread: a recipient can read the shared thread and sees sharedBy populated", async () => {
    const { userId: owner, name: ownerName } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
      name: "Owner Person",
    });
    const { userId: recipient } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });

    const thread = await createThread(ctx.db)(owner, "Shared scout thread");
    await shareThread(ctx.db)(owner, thread.id, [recipient]);

    const ownerView = await getThread(ctx.db)(owner, thread.id);
    expect(ownerView.thread.sharedBy).toBeNull();
    expect(ownerView.thread.sharedByMe).toBe(true);

    const recipientView = await getThread(ctx.db)(recipient, thread.id);
    expect(recipientView.thread.sharedBy?.id).toBe(owner);
    expect(recipientView.thread.sharedBy?.name).toBe(ownerName);
    expect(recipientView.thread.sharedByMe).toBe(false);
  });

  it("listThreads merges owned + shared, with sharedBy / sharedByMe set per row", async () => {
    const { userId: alice } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const { userId: bob } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });

    const aliceThread = await createThread(ctx.db)(alice, "Alice's analysis");
    const bobsShared = await createThread(ctx.db)(bob, "Bob's plan");
    await shareThread(ctx.db)(bob, bobsShared.id, [alice]);

    const aliceList = await listThreads(ctx.db)(alice);
    const own = aliceList.find((t) => t.id === aliceThread.id);
    const shared = aliceList.find((t) => t.id === bobsShared.id);
    expect(own?.sharedByMe).toBe(false); // owns it but hasn't shared
    expect(own?.sharedBy).toBeNull();
    expect(shared?.sharedBy?.id).toBe(bob);
    expect(shared?.sharedByMe).toBe(false);

    // Alice now shares her own thread with Bob → sharedByMe flips for her.
    await shareThread(ctx.db)(alice, aliceThread.id, [bob]);
    const aliceListAfter = await listThreads(ctx.db)(alice);
    expect(
      aliceListAfter.find((t) => t.id === aliceThread.id)?.sharedByMe,
    ).toBe(true);
  });

  it("share + unshare are idempotent (no duplicate rows; unshare twice is fine)", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const { userId: rec } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });

    const thread = await createThread(ctx.db)(owner, "Idempotent thread");
    await shareThread(ctx.db)(owner, thread.id, [rec]);
    await shareThread(ctx.db)(owner, thread.id, [rec]); // re-share, no-op
    const sharees = await listSharees(ctx.db)(owner, thread.id);
    expect(sharees.map((s) => s.id)).toEqual([rec]);

    await unshareThread(ctx.db)(owner, thread.id, rec);
    await unshareThread(ctx.db)(owner, thread.id, rec); // unshare twice, no-op
    expect(await listSharees(ctx.db)(owner, thread.id)).toEqual([]);
  });

  it("share + unshare refuse to run for a non-owner (ShareForbiddenError)", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const { userId: imposter } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "admin",
    });
    const { userId: target } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });

    const thread = await createThread(ctx.db)(owner, "Locked");
    await expect(
      shareThread(ctx.db)(imposter, thread.id, [target]),
    ).rejects.toBeInstanceOf(ShareForbiddenError);
    await expect(
      unshareThread(ctx.db)(imposter, thread.id, target),
    ).rejects.toBeInstanceOf(ShareForbiddenError);
  });

  it("share rejects recipients without ai_chat:use permission", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const { userId: civilian } = await seedTestUser(ctx.db, {
      withMember: false,
      // explicit no role — `null` is the default for plain users
      role: null as unknown as string,
    });
    // Legacy `official` role lacks ai_chat:use — not eligible.
    const { userId: official } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "official",
    });

    const thread = await createThread(ctx.db)(owner, "Restricted");
    await expect(
      shareThread(ctx.db)(owner, thread.id, [civilian]),
    ).rejects.toBeInstanceOf(ShareInvalidRecipientError);
    await expect(
      shareThread(ctx.db)(owner, thread.id, [official]),
    ).rejects.toBeInstanceOf(ShareInvalidRecipientError);
  });

  it("share rejects sharing with self", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const thread = await createThread(ctx.db)(owner, "Solo");
    await expect(
      shareThread(ctx.db)(owner, thread.id, [owner]),
    ).rejects.toBeInstanceOf(ShareInvalidRecipientError);
  });

  it("a non-shared, non-owner user cannot read the thread (404 via ThreadNotFoundError)", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const { userId: stranger } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const thread = await createThread(ctx.db)(owner, "Private");

    await expect(getThread(ctx.db)(stranger, thread.id)).rejects.toBeInstanceOf(
      ThreadNotFoundError,
    );
  });

  it("copyThread forks a shared thread under the recipient with messages copied", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const { userId: recipient } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });

    const thread = await createThread(ctx.db)(owner, "Original analysis");
    await appendMessage(ctx.db)(thread.id, "user", [
      { type: "text", text: "Who's bowling for Mitford?" },
    ]);
    await appendMessage(ctx.db)(thread.id, "assistant", [
      { type: "text", text: "Three seamers and one off-spinner." },
    ]);
    await shareThread(ctx.db)(owner, thread.id, [recipient]);

    const copied = await copyThread(ctx.db)(recipient, thread.id);
    expect(copied.id).not.toBe(thread.id);
    expect(copied.title).toBe("Copy of Original analysis");
    expect(copied.sharedBy).toBeNull();
    expect(copied.sharedByMe).toBe(false);

    // The copy belongs to the recipient — they can read it as owner.
    const reload = await getThread(ctx.db)(recipient, copied.id);
    expect(reload.thread.id).toBe(copied.id);
    expect(reload.messages).toHaveLength(2);
    expect(reload.messages[0].role).toBe("user");
    expect(reload.messages[1].role).toBe("assistant");

    // The original is untouched.
    const original = await getThread(ctx.db)(owner, thread.id);
    expect(original.messages).toHaveLength(2);
  });

  it("copyThread refuses to copy a thread the user can't read (ThreadNotFoundError)", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const { userId: stranger } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const thread = await createThread(ctx.db)(owner, "Hidden");
    await expect(
      copyThread(ctx.db)(stranger, thread.id),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it("copyThread doesn't double-prefix titles that already start with 'Copy of '", async () => {
    const { userId: owner } = await seedTestUser(ctx.db, {
      withMember: false,
      role: "ai_chat_user",
    });
    const thread = await createThread(ctx.db)(owner, "Copy of Old plan");
    const copied = await copyThread(ctx.db)(owner, thread.id);
    expect(copied.title).toBe("Copy of Old plan");
  });
});

describe("listRecentDebriefMatches (integration)", () => {
  it("returns matches identified by club_id in the last 14 days, descending, joining club_name + team_name for display", async () => {
    const SITE_ID = "134";
    const now = new Date("2026-05-04T12:00:00Z");
    const within = "2026-05-01"; // 3 days before now
    const oldest = "2026-04-22"; // 12 days before now (in window)
    const stale = "2026-04-15"; // 19 days before now (outside)

    // Wipe + seed match_result rows directly. PC stores team names bare
    // ("1st XI", "2nd XI") for both sides; club_id is the only reliable
    // disambiguator. Each fixture exercises a branch: home, away, stale,
    // non-ours, and a legacy NULL-club_id row that the filter must skip.
    await ctx.db.deleteFrom("match_result").execute();
    await ctx.db
      .insertInto("match_result")
      .values([
        {
          id: crypto.randomUUID(),
          match_id: "1001",
          match_date: within,
          home_team_id: "h1",
          away_team_id: "a1",
          home_team_name: "1st XI",
          away_team_name: "1st XI",
          home_club_id: SITE_ID,
          home_club_name: "Percy Main",
          away_club_id: "201",
          away_club_name: "Mitford CC",
          result: "won",
          result_description: "Won by 5 wickets",
          result_applied_to: "h1",
          competition_type: "League",
          season: 2026,
        },
        {
          id: crypto.randomUUID(),
          match_id: "1002",
          match_date: oldest,
          home_team_id: "h2",
          away_team_id: "a2",
          home_team_name: "2nd XI",
          away_team_name: "2nd XI",
          home_club_id: "202",
          home_club_name: "Tynemouth CC",
          away_club_id: SITE_ID,
          away_club_name: "Percy Main",
          result: "lost",
          result_description: "Lost by 30 runs",
          result_applied_to: "h2",
          competition_type: "League",
          season: 2026,
        },
        {
          id: crypto.randomUUID(),
          match_id: "1003",
          match_date: stale,
          home_team_id: "h3",
          away_team_id: "a3",
          home_team_name: "1st XI",
          away_team_name: "1st XI",
          home_club_id: SITE_ID,
          home_club_name: "Percy Main",
          away_club_id: "203",
          away_club_name: "Northumberland CC",
          result: "won",
          result_description: "Won",
          result_applied_to: "h3",
          competition_type: "League",
          season: 2026,
        },
        {
          id: crypto.randomUUID(),
          match_id: "1004",
          match_date: within,
          home_team_id: "h4",
          away_team_id: "a4",
          home_team_name: "1st XI",
          away_team_name: "1st XI",
          home_club_id: "202",
          home_club_name: "Tynemouth CC",
          away_club_id: "201",
          away_club_name: "Mitford CC",
          result: "won",
          result_description: "Won by 50 runs",
          result_applied_to: "h4",
          competition_type: "League",
          season: 2026,
        },
        {
          // Legacy row written before the migration: club_id columns NULL.
          // The launcher's club_id equality filter must skip it cleanly.
          id: crypto.randomUUID(),
          match_id: "1005",
          match_date: within,
          home_team_id: "h5",
          away_team_id: "a5",
          home_team_name: "3rd XI",
          away_team_name: "3rd XI",
          result: "won",
          result_description: "Won",
          result_applied_to: "h5",
          competition_type: "League",
          season: 2026,
        },
      ])
      .execute();

    const out = await listRecentDebriefMatches(ctx.db, SITE_ID)(14, now);

    // Only 1001 (home) and 1002 (away) match: in-window AND our club_id is
    // home or away. 1003 is stale, 1004 is two other clubs, 1005 is legacy
    // NULL club_id. Most-recent first.
    expect(out.map((m) => m.id)).toEqual(["1001", "1002"]);

    expect(out[0]).toMatchObject({
      id: "1001",
      matchDate: within,
      opposition: "Mitford CC 1st XI",
      homeAway: "home",
      ourTeam: "Percy Main 1st XI",
      result: "Won by 5 wickets",
    });
    expect(out[1]).toMatchObject({
      id: "1002",
      matchDate: oldest,
      opposition: "Tynemouth CC 2nd XI",
      homeAway: "away",
      ourTeam: "Percy Main 2nd XI",
    });
  });
});

describe("Play Cricket tools (with stub client)", () => {
  it("calls the underlying client and caches by argument shape", async () => {
    const cache = createScoutCache(ctx.db);
    let calls = 0;
    const playCricket = {
      getTeams: () => Promise.resolve({ teams: [] }),
      getPlayers: () => {
        calls++;
        return Promise.resolve({
          players: [{ member_id: 1, name: "Test Player" }],
        });
      },
      getMatchDetail: () => Promise.resolve({}),
      getMatchesSummary: () => Promise.resolve({ matches: [] }),
      getLeagueTable: () => Promise.resolve({ league_table: [] }),
    } as never;

    const tools = createPlayCricketTools({ playCricket, cache });

    const a = await runTool<unknown>(tools.pc_list_players.execute, {});
    const b = await runTool<unknown>(tools.pc_list_players.execute, {});

    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });

  it("caches the raw payload and projects per-call so different field selections share one fetch", async () => {
    const cache = createScoutCache(ctx.db);
    let calls = 0;
    const playCricket = {
      getMatchesSummary: () => {
        calls++;
        return Promise.resolve({
          matches: [
            {
              id: 1,
              match_date: "01/05/2025",
              home_team_name: "Percy Main",
              away_team_name: "Morpeth",
              status: "Result",
              ground_name: "Preston Avenue",
            },
            {
              id: 2,
              match_date: "08/05/2025",
              home_team_name: "Tynemouth",
              away_team_name: "Percy Main",
              status: "Result",
              ground_name: "Preston Avenue",
            },
          ],
        });
      },
      getTeams: () => Promise.resolve({ teams: [] }),
      getPlayers: () => Promise.resolve({ players: [] }),
      getMatchDetail: () => Promise.resolve({}),
      getLeagueTable: () => Promise.resolve({ league_table: [] }),
    } as never;

    const tools = createPlayCricketTools({ playCricket, cache });

    // Use a unique season so this test doesn't collide with cache rows from
    // sibling tests sharing the same DB.
    const season = 2099;

    const narrow = await runTool<unknown>(tools.pc_match_summary.execute, {
      season,
      fields: ["matches[].id", "matches[].match_date"],
    });
    expect(narrow).toEqual({
      matches: [
        { id: 1, match_date: "01/05/2025" },
        { id: 2, match_date: "08/05/2025" },
      ],
    });

    const wider = await runTool<unknown>(tools.pc_match_summary.execute, {
      season,
      fields: [
        "matches[].id",
        "matches[].home_team_name",
        "matches[].away_team_name",
      ],
    });
    expect(wider).toEqual({
      matches: [
        {
          id: 1,
          home_team_name: "Percy Main",
          away_team_name: "Morpeth",
        },
        {
          id: 2,
          home_team_name: "Tynemouth",
          away_team_name: "Percy Main",
        },
      ],
    });

    // Different fields → same underlying API call. Caching is keyed by the
    // tool args minus `fields`.
    expect(calls).toBe(1);
  });
});
