import type { DB } from "@percy-main/db";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.ts";

let ctx: TestContext;
let mcpDb: Kysely<DB>;
let mcpPool: pg.Pool;

beforeAll(async () => {
  ctx = await startTestContainer();

  // Migrations created mcp_readonly NOLOGIN with no password — the same
  // way it lands in prod. Tests need to actually connect as that role, so
  // grant LOGIN + a password here. Mirrors what the dev/Terraform setup
  // does out-of-band.
  await sql`ALTER ROLE mcp_readonly WITH LOGIN PASSWORD 'integration_test_pwd'`.execute(
    ctx.db,
  );

  const url = new URL(ctx.connectionString);
  url.username = "mcp_readonly";
  url.password = "integration_test_pwd";
  mcpPool = new pg.Pool({ connectionString: url.toString(), max: 3 });
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- swallow shutdown noise
  mcpPool.on("error", () => {});
  mcpDb = new Kysely<DB>({ dialect: new PostgresDialect({ pool: mcpPool }) });
}, 60_000);

afterAll(async () => {
  // mcpDb.destroy() ends mcpPool internally — calling pool.end() again
  // would throw "Called end on pool more than once".
  await mcpDb.destroy();
  await stopTestContainer(ctx);
});

describe("mcp_readonly role boundary (security-critical)", () => {
  it("can SELECT from the member_public view", async () => {
    const out = await sql<{
      count: string;
    }>`SELECT count(*) FROM member_public`.execute(mcpDb);
    expect(out.rows).toHaveLength(1);
  });

  it("can SELECT from allowlisted matchday table", async () => {
    const out = await sql<{
      count: string;
    }>`SELECT count(*) FROM matchday`.execute(mcpDb);
    expect(out.rows).toHaveLength(1);
  });

  it("CANNOT SELECT dob from member_public (redaction is the view itself, not just the grant)", async () => {
    await expect(
      sql`SELECT dob FROM member_public LIMIT 1`.execute(mcpDb),
    ).rejects.toThrow(/column .* does not exist/i);
  });

  it("CANNOT SELECT from user table (sensitive)", async () => {
    await expect(
      sql`SELECT email FROM "user" LIMIT 1`.execute(mcpDb),
    ).rejects.toThrow(/permission denied|relation .* does not exist/i);
  });

  it("CANNOT SELECT from member table directly (only via member_public view)", async () => {
    await expect(
      sql`SELECT * FROM member LIMIT 1`.execute(mcpDb),
    ).rejects.toThrow(/permission denied|relation .* does not exist/i);
  });

  it("CANNOT SELECT from availability_request (reachable only via the personalized tools, not raw SQL)", async () => {
    await expect(
      sql`SELECT * FROM availability_request LIMIT 1`.execute(mcpDb),
    ).rejects.toThrow(/permission denied|relation .* does not exist/i);
  });

  it("CANNOT SELECT from charge table", async () => {
    await expect(
      sql`SELECT * FROM charge LIMIT 1`.execute(mcpDb),
    ).rejects.toThrow(/permission denied|relation .* does not exist/i);
  });

  it("CANNOT INSERT into matchday (read-only on allowed tables)", async () => {
    await expect(
      sql`INSERT INTO matchday (id, match_date) VALUES (gen_random_uuid(), '2025-06-01')`.execute(
        mcpDb,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("CANNOT UPDATE matchday", async () => {
    await expect(
      sql`UPDATE matchday SET match_date = '2025-06-01'`.execute(mcpDb),
    ).rejects.toThrow(/permission denied/i);
  });

  it("CANNOT DELETE from matchday", async () => {
    await expect(sql`DELETE FROM matchday`.execute(mcpDb)).rejects.toThrow(
      /permission denied/i,
    );
  });
});
