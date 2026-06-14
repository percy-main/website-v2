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

/**
 * Run a Scout tool's execute fn in a test, asserting it's defined.
 * Avoids the `tool.execute!(...)` non-null assertion lint error and
 * centralises the result cast that strict-type-checked eslint flags
 * when callers do `as { ... }` directly.
 */
async function runTool<T>(
  exec: ((input: never, opts: never) => unknown) | undefined,
  input: unknown,
): Promise<T> {
  if (!exec) throw new Error("tool has no execute");
  return (await exec(input as never, opts as never)) as T;
}

describe("db_run_sql", () => {
  it("rejects an INSERT", async () => {
    const result = await runTool<{ error: string }>(tools.db_run_sql.execute, {
      query: "INSERT INTO scout_member (id) VALUES ('x')",
    });
    expect(result.error).toMatch(/must start with SELECT or WITH/);
  });

  it("rejects an UPDATE", async () => {
    const result = await runTool<{ error: string }>(tools.db_run_sql.execute, {
      query: "UPDATE scout_member SET name = 'x'",
    });
    expect(result.error).toMatch(/must start with SELECT or WITH/);
  });

  it("rejects a DELETE", async () => {
    const result = await runTool<{ error: string }>(tools.db_run_sql.execute, {
      query: "DELETE FROM scout_member",
    });
    expect(result.error).toMatch(/must start with SELECT or WITH/);
  });

  it("rejects DDL", async () => {
    const result = await runTool<{ error: string }>(tools.db_run_sql.execute, {
      query: "DROP TABLE scout_member",
    });
    expect(result.error).toMatch(/must start with SELECT or WITH/);
  });

  it("rejects sneaky leading whitespace + uppercase write", async () => {
    const result = await runTool<{ error: string }>(tools.db_run_sql.execute, {
      query: "  \n  INSERT INTO foo VALUES (1)",
    });
    expect(result.error).toMatch(/must start with SELECT or WITH/);
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

    const result = await runTool<{
      rows: Array<{ count: number }>;
      rowCount: number;
      truncated: boolean;
    }>(tools.db_run_sql.execute, {
      query: "SELECT count(*) FROM scout_member",
    });
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

    const result = await runTool<Record<string, unknown>>(
      tools.db_run_sql.execute,
      { query: "WITH x AS (SELECT 1) SELECT * FROM x" },
    );
    expect(result).not.toHaveProperty("error");
  });
});

describe("db_describe_table", () => {
  it("rejects tables not in the allowlist", async () => {
    const result = await runTool<{ error: string }>(
      tools.db_describe_table.execute,
      { table: "user" },
    );
    expect(result.error).toMatch(/not in the Scout allowlist/);
  });

  it("does not call the database for disallowed tables", async () => {
    const executeQuery = vi.fn();
    (
      dbReadonly as unknown as { executeQuery: typeof executeQuery }
    ).executeQuery = executeQuery;
    await runTool<unknown>(tools.db_describe_table.execute, {
      table: "charge",
    });
    expect(executeQuery).not.toHaveBeenCalled();
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

    const result = await runTool<{
      name: string;
      columns: Array<{ name: string; type: string; nullable: boolean }>;
    }>(tools.db_describe_table.execute, { table: "scout_member" });
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

  it("includes the ball-by-ball surface (folded in from ask_ball_by_ball)", () => {
    for (const t of ["match_ball", "match_stream", "rv_player_mapping"]) {
      expect(SCOUT_ALLOWED_TABLES).toContain(t);
    }
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
