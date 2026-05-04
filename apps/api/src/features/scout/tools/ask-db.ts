import type { DB } from "@percy-main/db";
import { generateText, stepCountIs, tool } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { resolveModel, type ScoutProvider } from "../provider.ts";
import { createDbTools, SCOUT_ALLOWED_TABLES } from "./db.ts";

/**
 * ask_db — the main agent's only door to the database.
 *
 * Why it's a sub-agent and not three direct tools:
 *
 * The main chat agent's job is to *reason about cricket*, not to debug SQL.
 * Exposing db_list_tables / db_describe_table / db_run_sql directly meant
 * every typo, schema misunderstanding, or aggregate-vs-row mistake landed
 * in the chat context, doubled the token bill on every retry, and pushed
 * earlier prose far enough out of view that the model lost the thread.
 *
 * Wrapping the SQL loop in its own short-context generateText call gives us:
 *
 *   - **Isolation.** Failed queries, schema dumps, and intermediate row
 *     samples never reach the main agent. It only sees the final summary
 *     and (optionally) a small structured rows array.
 *   - **Specialisation.** Sub-agent runs on a model picked for SQL fluency
 *     (default Haiku — fast, cheap, strong on SELECT generation) regardless
 *     of what the main chat is on (Sonnet, DeepSeek-v4-pro, etc.).
 *   - **Bounded cost.** stopWhen: stepCountIs(N) caps each call. Most
 *     answers come back in 1–3 steps; the cap is a safety net.
 *
 * Output shape: text from the sub-agent's final response is the summary.
 * If the sub-agent's last db_run_sql call returned rows, we attach them so
 * the main agent can quote specific innings without re-querying. Aggregate
 * questions ("how many ducks?") get summary-only; row questions ("list
 * Smith's centuries") get rows.
 */

interface SqlResult {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowCount: number;
  truncated: boolean;
}

export interface AskDbToolDeps {
  dbReadonly: Kysely<DB>;
  provider: ScoutProvider;
  modelId: string;
  maxSteps: number;
  logger?: FastifyBaseLogger;
}

export function createAskDbTool(deps: AskDbToolDeps) {
  const { model } = resolveModel(deps.provider, deps.modelId);

  return {
    ask_db: tool({
      description: `Answer a question from the Scout database. Pass a natural-language question; a SQL specialist runs the queries and returns a concise summary plus (when relevant) a small rows array.

Use this whenever you need data — players, matches, performances, availability, etc. Do NOT try to reason about SQL yourself; just ask the question. Examples:

  - "How many ducks did James Smith have in 2025?"
  - "List the 1st XI bowlers with the best economy in 2024 (min 30 overs)."
  - "What's our W/D/L record at home vs away in the last 3 seasons?"
  - "Which players are available for Saturday?"

If the response includes \`rows\`, you may quote them directly in your reply. If it doesn't, the \`summary\` is the answer — don't ask again for "the data" unless you genuinely need raw rows for citation.`,
      inputSchema: z.object({
        question: z
          .string()
          .min(3)
          .describe(
            "Plain-English question. Be specific (player name, season, team, format) — don't pass a vague reference, the sub-agent has no chat context.",
          ),
      }),
      execute: async ({ question }) => {
        const tools = createDbTools({ dbReadonly: deps.dbReadonly });

        const today = new Date();
        const iso = today.toISOString().slice(0, 10);
        const ddmmyyyy = today.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

        const system = `You are a SQL specialist for the Percy Main CSC Scout database (PostgreSQL, public schema, read-only).

Your job: answer the user's natural-language question by running SELECT queries and writing a CONCISE answer.

Today is ${iso} (${ddmmyyyy} dd/mm/yyyy). Current season is ${today.getFullYear()}.

Tables available (call db_list_tables for full schema, db_describe_table for one table):
${SCOUT_ALLOWED_TABLES.map((t) => `  - ${t}`).join("\n")}

CRITICAL rules — apply on every query:

1. **match_date is text in dd/mm/yyyy.** Lexicographic ordering is wrong ("31/08/2013" sorts after "07/06/2025"). Always use to_date(match_date, 'DD/MM/YYYY') for any ORDER BY, comparison, or BETWEEN.

2. **Aggregate in SQL, never in your head.** Counts, sums, averages, distributions, top-N — write a query that COMPUTES the answer. Pulling 200 rows back to count them is wasteful and inaccurate.

3. **Rows or summary, not both unless asked.** If the question is "how many" / "what's the average" / "which player has most" → answer is one number or one row, summary string only. If the question is "list" / "show me" / "give me each" → return rows.

4. **Bound row results.** ORDER BY + LIMIT. Never SELECT * back; pick the columns you'll quote.

5. **Stop when you have the answer.** After you can answer the question, write your reply and STOP — don't keep poking. You have ${deps.maxSteps} steps total.

Output: write a one-or-two-sentence summary directly addressing the question. If the user explicitly wanted rows, your final db_run_sql result is what gets passed up — make sure it's the answer query, not a debug query.

If you cannot answer (table missing, ambiguous question, schema mismatch), say so plainly in one sentence — don't fabricate.`;

        const startedAt = Date.now();
        let result;
        try {
          result = await generateText({
            model,
            system,
            prompt: question,
            tools,
            stopWhen: stepCountIs(deps.maxSteps),
          });
        } catch (err) {
          deps.logger?.error(
            { err, question, provider: deps.provider, model: deps.modelId },
            "ask_db: sub-agent generateText failed",
          );
          return {
            error:
              "DB query helper failed. Try rephrasing the question or ask again in a moment.",
          };
        }

        // Walk the steps for the last successful db_run_sql tool result —
        // that's the query that produced the answer. Schema queries
        // (db_list_tables, db_describe_table) are intermediate plumbing and
        // never the answer. Done inline because generateText's `steps` is
        // typed against the specific ToolSet passed in, and a helper would
        // either need to be generic or use an unsafe cast.
        let lastSql: SqlResult | null = null;
        for (let i = result.steps.length - 1; i >= 0 && !lastSql; i--) {
          const step = result.steps[i];
          for (let j = step.content.length - 1; j >= 0; j--) {
            const part = step.content[j];
            if (
              part.type === "tool-result" &&
              part.toolName === "db_run_sql" &&
              isSqlResult(part.output)
            ) {
              lastSql = part.output;
              break;
            }
          }
        }
        const elapsedMs = Date.now() - startedAt;
        const stepCount = result.steps.length;

        deps.logger?.info(
          {
            event: "scout.ask_db",
            question,
            provider: deps.provider,
            model: deps.modelId,
            stepCount,
            elapsedMs,
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            hasRows: !!lastSql,
            rowCount: lastSql?.rowCount ?? 0,
          },
          "scout: ask_db sub-agent done",
        );

        const summary = result.text.trim();
        if (!summary && !lastSql) {
          return {
            error:
              "DB query helper returned no answer. The question may be ambiguous; try rephrasing.",
          };
        }

        if (lastSql) {
          return {
            summary: summary || "Query returned the rows below.",
            rows: lastSql.rows,
            columns: lastSql.columns,
            rowCount: lastSql.rowCount,
            truncated: lastSql.truncated,
          };
        }
        return { summary };
      },
    }),
  };
}

function isSqlResult(value: unknown): value is SqlResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.rows) &&
    Array.isArray(v.columns) &&
    typeof v.rowCount === "number" &&
    typeof v.truncated === "boolean"
  );
}
