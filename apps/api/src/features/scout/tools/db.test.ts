import type { DB } from "@percy-main/db";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { createDbTools, SCOUT_ALLOWED_TABLES } from "./db.ts";

// Minimal ToolExecutionOptions stub. The ai-sdk type is complex but the only
// fields our tool execution actually uses are passed through to nothing —
// every Scout tool ignores the options arg.
const opts = {
  toolCallId: "test-call",
  messages: [],
  abortSignal: undefined,
} as unknown as Parameters<NonNullable<typeof tools.db_run_sql.execute>>[1];

const dbReadonly = {
  executeQuery: vi.fn(),
  transaction: vi.fn(),
} as unknown as Kysely<DB>;

const tools = createDbTools({ dbReadonly });

describe("db_run_sql", () => {
  it("rejects an INSERT", async () => {
    const result = await tools.db_run_sql.execute!(
      { query: "INSERT INTO scout_member (id) VALUES ('x')" },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("must start with SELECT or WITH"),
    });
  });

  it("rejects an UPDATE", async () => {
    const result = await tools.db_run_sql.execute!(
      { query: "UPDATE scout_member SET name = 'x'" },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("must start with SELECT or WITH"),
    });
  });

  it("rejects a DELETE", async () => {
    const result = await tools.db_run_sql.execute!(
      { query: "DELETE FROM scout_member" },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("must start with SELECT or WITH"),
    });
  });

  it("rejects DDL", async () => {
    const result = await tools.db_run_sql.execute!(
      { query: "DROP TABLE scout_member" },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("must start with SELECT or WITH"),
    });
  });

  it("rejects sneaky leading whitespace + uppercase write", async () => {
    const result = await tools.db_run_sql.execute!(
      { query: "  \n  INSERT INTO foo VALUES (1)" },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("must start with SELECT or WITH"),
    });
  });

  it("accepts a SELECT (passes through to the executor)", async () => {
    const txExecute = vi
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          executeQuery: vi
            .fn()
            // SET LOCAL statement_timeout
            .mockResolvedValueOnce({ rows: [] })
            // SET LOCAL transaction_read_only
            .mockResolvedValueOnce({ rows: [] })
            // user query
            .mockResolvedValueOnce({ rows: [{ count: 5 }] }),
        };
        return await cb(tx);
      });
    (dbReadonly as unknown as { transaction: () => unknown }).transaction = vi
      .fn()
      .mockReturnValue({ execute: txExecute });

    const result = await tools.db_run_sql.execute!(
      { query: "SELECT count(*) FROM scout_member" },
      opts,
    );
    expect(result).toMatchObject({
      rows: [{ count: 5 }],
      rowCount: 1,
      truncated: false,
    });
  });

  it("accepts a WITH (CTE)", async () => {
    const txExecute = vi
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          executeQuery: vi
            .fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return await cb(tx);
      });
    (dbReadonly as unknown as { transaction: () => unknown }).transaction = vi
      .fn()
      .mockReturnValue({ execute: txExecute });

    const result = await tools.db_run_sql.execute!(
      { query: "WITH x AS (SELECT 1) SELECT * FROM x" },
      opts,
    );
    expect(result).not.toHaveProperty("error");
  });
});

describe("db_describe_table", () => {
  it("rejects tables not in the allowlist", async () => {
    const result = await tools.db_describe_table.execute!(
      { table: "user" },
      opts,
    );
    expect(result).toMatchObject({
      error: expect.stringContaining("not in the Scout allowlist"),
    });
  });

  it("does not call the database for disallowed tables", async () => {
    (
      dbReadonly as unknown as { executeQuery: ReturnType<typeof vi.fn> }
    ).executeQuery = vi.fn();
    await tools.db_describe_table.execute!({ table: "charge" }, opts);
    expect(
      (dbReadonly as unknown as { executeQuery: ReturnType<typeof vi.fn> })
        .executeQuery,
    ).not.toHaveBeenCalled();
  });

  it("queries information_schema for allowed tables", async () => {
    const executeQuery = vi.fn().mockResolvedValue({
      rows: [
        { column_name: "id", data_type: "uuid", is_nullable: "NO" },
        { column_name: "name", data_type: "text", is_nullable: "YES" },
      ],
    });
    (
      dbReadonly as unknown as { executeQuery: typeof executeQuery }
    ).executeQuery = executeQuery;

    const result = await tools.db_describe_table.execute!(
      { table: "scout_member" },
      opts,
    );
    expect(result).toMatchObject({
      name: "scout_member",
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "name", type: "text", nullable: true },
      ],
    });
  });
});

describe("SCOUT_ALLOWED_TABLES", () => {
  it("includes scout_member view", () => {
    expect(SCOUT_ALLOWED_TABLES).toContain("scout_member");
  });

  it("does not include sensitive tables", () => {
    const sensitive = [
      "user",
      "account",
      "session",
      "member",
      "charge",
      "membership",
    ];
    for (const t of sensitive) {
      expect(SCOUT_ALLOWED_TABLES).not.toContain(t);
    }
  });
});
