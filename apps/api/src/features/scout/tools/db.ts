import type { DB } from "@percy-main/db";
import { tool } from "ai";
import { CompiledQuery, type Kysely } from "kysely";
import { z } from "zod";

/**
 * Tables Scout's read-only role has SELECT on, plus the redacted scout_member
 * view. Mirrors the GRANT in migration 2026-05-03. Including the list here as
 * defence-in-depth + cleaner output from db_list_tables; the role's grants are
 * the actual security boundary.
 */
export const SCOUT_ALLOWED_TABLES = [
  "matchday",
  "matchday_player",
  "match_result",
  "match_performance_batting",
  "match_performance_bowling",
  "match_performance_fielding",
  "play_cricket_match_cache",
  "play_cricket_team",
  "play_cricket_sync_log",
  "availability_fixture",
  "availability_request",
  "availability_response",
  "availability_assignment",
  "scout_member",
] as const;

const ROW_CAP = 500;
const STATEMENT_TIMEOUT_SECONDS = 30;

export interface DbToolDeps {
  dbReadonly: Kysely<DB>;
}

export function createDbTools(deps: DbToolDeps) {
  const { dbReadonly } = deps;

  return {
    db_list_tables: tool({
      description:
        "List the tables Scout can read, with their columns and types. Call this first when you need to know what data is available before writing a SQL query.",
      inputSchema: z.object({}),
      execute: async () => {
        const placeholders = SCOUT_ALLOWED_TABLES.map(
          (_, i) => `$${i + 1}`,
        ).join(",");
        const out = await dbReadonly.executeQuery(
          CompiledQuery.raw(
            `SELECT table_name, column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name IN (${placeholders})
             ORDER BY table_name, ordinal_position`,
            [...SCOUT_ALLOWED_TABLES],
          ),
        );

        const rows = out.rows as Array<{
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>;

        const byTable = new Map<
          string,
          Array<{ name: string; type: string; nullable: boolean }>
        >();
        for (const row of rows) {
          let cols = byTable.get(row.table_name);
          if (!cols) {
            cols = [];
            byTable.set(row.table_name, cols);
          }
          cols.push({
            name: row.column_name,
            type: row.data_type,
            nullable: row.is_nullable === "YES",
          });
        }

        return {
          tables: [...byTable.entries()].map(([name, columns]) => ({
            name,
            columns,
          })),
        };
      },
    }),

    db_describe_table: tool({
      description:
        "Describe a single table — its columns, types, and nullability. Cheaper than db_list_tables when you already know which table you need.",
      inputSchema: z.object({
        table: z.string().describe("Table name. Must be in the allowlist."),
      }),
      execute: async ({ table }) => {
        if (!(SCOUT_ALLOWED_TABLES as readonly string[]).includes(table)) {
          return {
            error: `Table "${table}" is not in the Scout allowlist. Use db_list_tables to see what's available.`,
            allowed: SCOUT_ALLOWED_TABLES,
          };
        }

        const out = await dbReadonly.executeQuery(
          CompiledQuery.raw(
            `SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
             ORDER BY ordinal_position`,
            [table],
          ),
        );
        const rows = out.rows as Array<{
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>;

        return {
          name: table,
          columns: rows.map((r) => ({
            name: r.column_name,
            type: r.data_type,
            nullable: r.is_nullable === "YES",
          })),
        };
      },
    }),

    db_run_sql: tool({
      description: `Run an ad-hoc read-only SQL query against the Scout database. Use only when the curated tools cannot express what you need (e.g. multi-table joins, aggregates).

Rules:
- Query must start with SELECT or WITH. INSERT/UPDATE/DELETE/DDL are rejected (and the role lacks the grants anyway).
- Results are capped at ${ROW_CAP} rows; the response includes a "truncated" flag if the cap was hit.
- Statement timeout is ${STATEMENT_TIMEOUT_SECONDS}s — long-running queries are rolled back.
- Schema is PostgreSQL/public. Use db_list_tables for an overview first.

CRITICAL — aggregate in SQL, do not pull raw rows and reduce them yourself:
If the question is about counts, sums, averages, max/min, frequencies, distributions, ratios, rankings, or "top N" — write a query that COMPUTES the answer in Postgres. Pulling 200 raw rows back to count them in your head is both expensive (every row lands in the chat context and is re-read on every subsequent step) and inaccurate (you lose precision doing arithmetic mentally that Postgres does exactly).

Heuristic: if the result set is going to be more than ~50 rows AND the user did not literally ask "list every X" or "show me the rows for Y" — you are probably writing the wrong query. Add a GROUP BY, aggregate, ORDER BY + LIMIT.

Aggregate-first patterns:

  -- Average / sum / count: one row, the answer
  SELECT AVG(runs)::int AS avg_runs FROM match_performance_batting WHERE player_name = 'Smith';
  SELECT COUNT(*) AS ducks FROM match_performance_batting WHERE player_name = 'Smith' AND runs = 0;

  -- Top N: small bounded result, the answer ranked
  SELECT player_name, COUNT(*) AS games
  FROM match_performance_batting
  GROUP BY player_name
  ORDER BY games DESC
  LIMIT 10;

  -- Distribution: one row per bucket
  SELECT how_out, COUNT(*) AS n
  FROM match_performance_batting
  WHERE season = '2025'
  GROUP BY how_out
  ORDER BY n DESC;

  -- "Most recent X" — push the filter+order+limit into SQL, don't sort in your head
  SELECT player_name, runs, match_date
  FROM match_performance_batting
  WHERE runs >= 100
  ORDER BY to_date(match_date, 'DD/MM/YYYY') DESC
  LIMIT 1;

When you DO need raw rows (e.g. quoting one specific innings in your reply), narrow with WHERE + ORDER BY + LIMIT, and SELECT only the columns you'll quote — do not SELECT *.

CRITICAL — match_date is text, not date:
\`match_date\` columns (on match_performance_*, match_result, play_cricket_match_cache, etc.) are stored as text in dd/mm/yyyy format because that's how Play Cricket returns them. Lexicographic ordering is WRONG: "31/08/2013" sorts AFTER "07/06/2025". Always wrap in to_date(match_date, 'DD/MM/YYYY') for any ORDER BY, comparison, or BETWEEN. Example: ORDER BY to_date(match_date, 'DD/MM/YYYY') DESC.`,
      inputSchema: z.object({
        query: z.string().describe("A single SELECT or WITH statement."),
      }),
      execute: async ({ query }) => {
        const trimmed = query.trim().replace(/;+\s*$/, "");
        const lower = trimmed.toLowerCase();
        if (!lower.startsWith("select") && !lower.startsWith("with")) {
          return {
            error:
              "Query must start with SELECT or WITH. Other statements are not permitted.",
          };
        }

        try {
          const result = await dbReadonly.transaction().execute(async (tx) => {
            await tx.executeQuery(
              CompiledQuery.raw(
                `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_SECONDS * 1000}`,
              ),
            );
            await tx.executeQuery(
              CompiledQuery.raw("SET LOCAL transaction_read_only = on"),
            );
            const out = await tx.executeQuery(
              CompiledQuery.raw(
                `SELECT * FROM (${trimmed}) _scout_q LIMIT ${ROW_CAP + 1}`,
              ),
            );
            return out.rows as Array<Record<string, unknown>>;
          });

          const truncated = result.length > ROW_CAP;
          const rows = truncated ? result.slice(0, ROW_CAP) : result;
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

          return {
            rows,
            columns,
            rowCount: rows.length,
            truncated,
          };
        } catch (err) {
          return {
            error:
              err instanceof Error
                ? err.message
                : "Query failed with an unknown error.",
          };
        }
      },
    }),
  };
}

export type DbTools = ReturnType<typeof createDbTools>;
