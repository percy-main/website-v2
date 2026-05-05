import type { DB } from "@percy-main/db";
import { generateText, stepCountIs, tool } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import {
  deepseekFastProviderOptions,
  resolveModel,
  type ScoutProvider,
} from "../provider.ts";
import { createDbTools, SCOUT_ALLOWED_TABLES } from "./db.ts";

/**
 * The model sometimes uses its assistant-text turn between tool calls as a
 * planning monologue ("Let me check the schema first.", "Perfect. Now let me
 * search..."). When the step budget hits mid-loop, that planning prose
 * becomes `result.text` and would otherwise be returned to the caller as if
 * it were the summary. Detect via prefix patterns or trailing colon.
 */
const PLANNING_PREFIX_RE =
  /^(let me\b|now let me\b|i'll\b|i will\b|next,? i'll\b|first,? i\b|perfect[.,!]?\s|got it[.,!]?\s|alright[.,!]?\s|ok[.,!]?\s|okay[.,!]?\s)/i;

export function looksLikePlanningProse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith(":")) return true;
  return PLANNING_PREFIX_RE.test(trimmed);
}

/**
 * Belt-and-braces backstop for the prompt rule "never name tables in your
 * summary". The model occasionally ignores it (we've seen "Now let me search
 * in matchday and match_result:"). Replace any allowlisted table token with
 * a generic placeholder so the leak doesn't reach the caller.
 */
function maskTableNames(summary: string): {
  masked: string;
  tablesFound: string[];
} {
  const tablesFound: string[] = [];
  let masked = summary;
  for (const t of SCOUT_ALLOWED_TABLES) {
    const re = new RegExp(`\\b${t}\\b`, "g");
    if (re.test(masked)) {
      tablesFound.push(t);
      masked = masked.replace(re, "the relevant table");
    }
  }
  return { masked, tablesFound };
}

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
 * Output shape: rows are the answer. The text returned from the sub-agent's
 * final response goes into `summary`, but it describes the *fetching
 * process* — assumptions, filters, fallbacks, errors — NOT a narrative of
 * the rows themselves. The main agent has the cricket context and is
 * responsible for ranking, formatting, and editorialising; double-narrating
 * here was both a token tax and a source of inconsistency between the two
 * voices in the same reply.
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
      description: `Answer a question from the Scout database. Pass a natural-language question; a SQL specialist runs the queries and returns the rows plus a short \`summary\` describing the FETCHING PROCESS (filters applied, assumptions made, errors), not a narrative of the data.

Use this whenever you need data — players, matches, performances, availability, etc. Do NOT try to reason about SQL yourself; just ask the question. Examples:

  - "How many ducks did James Smith have in 2025?"
  - "List the 1st XI bowlers with the best economy in 2024 (min 30 overs)."
  - "What's our W/D/L record at home vs away in the last 3 seasons?"
  - "Which players are available for Saturday?"

The rows ARE the answer — read them, then format/rank/editorialise yourself with cricket context. The \`summary\` is metadata about the query (e.g. "Filtered to game_type=1 (1st XI) and season=2025"); use it to verify any assumptions match what the user actually wanted, but do not parrot it back to the user as if it were the answer. If \`rows\` is missing the \`summary\` describes why (no matches, ambiguous question, error).`,
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

        const system = `You are a SQL fetcher for the Percy Main CSC Scout database (PostgreSQL, public schema, read-only).

Your job: run SELECT queries that ANSWER the question, and return the rows. A separate downstream agent reads your rows and writes the prose reply with cricket context — you do NOT write that prose yourself. Your final reply text is consumed as a short metadata note about the FETCHING PROCESS, not as a narrative of the data.

Today is ${iso} (${ddmmyyyy} dd/mm/yyyy). Current season is ${today.getFullYear()}.

Tables available (call db_list_tables for full schema, db_describe_table for one table):
${SCOUT_ALLOWED_TABLES.map((t) => `  - ${t}`).join("\n")}

CRITICAL rules — apply on every query:

1. **match_date is text in ISO YYYY-MM-DD.** Lex order matches chronological order, so ORDER BY / WHERE / BETWEEN work on the plain text column. Compare against today as '${iso}' (or current_date::text). The Play Cricket *API* still returns dd/mm/yyyy — that only matters when you're reading tool output, not when querying our DB. Don't wrap match_date in to_date(...).

2. **Aggregate in SQL, never in your head.** Counts, sums, averages, distributions, top-N — write a query that COMPUTES the answer. Pulling 200 rows back to count them is wasteful and inaccurate.

3. **Right-shape the rows.** "How many" → one row, one count column. "Top N" → N rows ranked. "List X" → the matching rows. ORDER BY + LIMIT every time. Never SELECT * back; pick the columns the downstream agent will need.

4. **Stop when the rows are right.** After the final db_run_sql call has the answer rows, write your short metadata reply and STOP — don't keep poking. You have ${deps.maxSteps} steps total.

5. **NEVER silently substitute a different filter.** If the user asks for 2026 and 2026 has no rows, return ZERO rows with a summary like "No 2026 rows for this query; latest season available is 2025." DO NOT run the same query against 2025 and return the rows as if they were the answer — the downstream agent will format that as the user's answer and ship a wrong reply. Same for player names, teams, formats, any filter. The right behaviour when the asked-for slice is empty: return empty rows + a summary that names the gap. The downstream agent decides whether to widen, ask the user, or fall back to another source.

OUTPUT — what to write as your final reply:

The summary is read by the OUTER agent, which is schema-blind by design. NEVER name a table, column, or any other piece of database structure in the summary — those are your implementation details. Phrase everything in cricket terms (matches, players, seasons, teams, formats).

DO write (one short sentence, sometimes two):
  - filters and assumptions you applied, in cricket terms: "Filtered to 1st XI league matches in 2025; minimum 10 wickets to exclude part-timers."
  - schema choices, abstracted: "Used the pre-aggregated bowling average rather than recomputing." — never name the column.
  - failure path: "No data for 'Bob Smith'; closest player name on file is 'Robert Smith'." / "Format filter unavailable — returned all formats."

DO NOT write:
  - any table or column name (no match_performance_batting, play_cricket_match_cache, game_type, etc.)
  - rankings, "highlights", or commentary on the rows ("Mashal leads with 34 wickets…")
  - markdown tables of the rows (the downstream agent formats those)
  - restating the question
  - empty filler ("Here are the results.")

If the rows are the entire answer (e.g. a count of 7), just say what filter you used — do NOT also say "the answer is 7", that's the rows' job.`;

        const startedAt = Date.now();
        let result;
        try {
          result = await generateText({
            model,
            system,
            prompt: question,
            tools,
            stopWhen: stepCountIs(deps.maxSteps),
            providerOptions: deepseekFastProviderOptions(deps.provider),
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

        const rawSummary = result.text.trim();

        // Did the loop terminate mid-conversation? If the LAST step's
        // finishReason is "tool-calls" (model wanted another tool but the
        // budget hit) or "length" (token cap), `rawSummary` is intermediate
        // planning prose, not a real summary. Strip it.
        const lastStep = result.steps[result.steps.length - 1];
        const cutOff =
          lastStep?.finishReason === "tool-calls" ||
          lastStep?.finishReason === "length" ||
          looksLikePlanningProse(rawSummary);

        let summary = cutOff ? "" : rawSummary;
        if (summary) {
          const { masked, tablesFound } = maskTableNames(summary);
          if (tablesFound.length > 0) {
            deps.logger?.warn(
              {
                event: "scout.ask_db.summary_named_tables",
                tablesFound,
                originalSummary: summary,
              },
              "ask_db: sub-agent named tables in summary; masked before returning",
            );
          }
          summary = masked;
        }

        if (!summary && !lastSql) {
          return {
            error:
              "DB query helper returned no answer. The question may be ambiguous; try rephrasing.",
          };
        }

        if (lastSql) {
          if (cutOff) {
            deps.logger?.warn(
              {
                event: "scout.ask_db.cut_off_mid_loop",
                stepCount,
                maxSteps: deps.maxSteps,
                lastFinishReason: lastStep?.finishReason,
                rawSummary,
              },
              "ask_db: sub-agent ran out of steps mid-loop; rows are from the last successful query but may be incomplete",
            );
          }
          return {
            summary: summary || null,
            rows: lastSql.rows,
            columns: lastSql.columns,
            rowCount: lastSql.rowCount,
            truncated: lastSql.truncated,
          };
        }
        // Sub-agent emitted a summary but never ran SQL — usually means it
        // narrated a plan ("Let me check the schema first.") and hit the step
        // budget before executing anything. Surface this as a structured
        // error rather than echoing the planning text as `summary`, which
        // misled the caller into thinking "no rows" was a real answer.
        deps.logger?.warn(
          {
            event: "scout.ask_db.no_sql_run",
            question,
            stepCount,
            rawSummary,
            maxSteps: deps.maxSteps,
            lastFinishReason: lastStep?.finishReason,
          },
          "ask_db: sub-agent finished without running any SQL",
        );
        return {
          error: `DB query helper finished without running SQL (in ${stepCount} step${stepCount === 1 ? "" : "s"} of ${deps.maxSteps}). Sub-agent's last note: ${rawSummary || "(empty)"}. Try a more specific question or wait for the next step.`,
        };
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
