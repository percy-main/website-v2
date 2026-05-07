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
import { looksLikePlanningProse, maskTableNames } from "./ask-db.ts";
import { createDbTools } from "./db.ts";

/**
 * Tables this sub-agent can read. Deliberately narrower than
 * SCOUT_ALLOWED_TABLES — keeps schema discovery tight and ensures the
 * agent's SQL stays on-topic (ball-by-ball + the joins it needs).
 *
 * The four non-BBB tables are the joins needed for an end-to-end query:
 *
 *   - match_result               — match date / opposition / our team
 *   - match_performance_batting  — how_out (only available for our players;
 *                                  RV's ball-level feed has no mode)
 *   - scout_member               — resolve a player name to their PC id
 *                                  (member.play_cricket_id), which then
 *                                  joins via rv_player_mapping.pc_player_id
 *   - play_cricket_team          — team name resolution for context
 *
 * The scout_readonly DB role's GRANTs are the actual security boundary;
 * this list governs db_list_tables / db_describe_table output and the
 * table-name masking applied to the sub-agent's summary text.
 */
export const ASK_BBB_ALLOWED_TABLES = [
  "match_ball",
  "match_stream",
  "rv_player_mapping",
  "match_result",
  "match_performance_batting",
  "scout_member",
  "play_cricket_team",
] as const;

interface SqlResult {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowCount: number;
  truncated: boolean;
}

export interface AskBallByBallToolDeps {
  dbReadonly: Kysely<DB>;
  provider: ScoutProvider;
  modelId: string;
  maxSteps: number;
  logger?: FastifyBaseLogger;
}

/**
 * ask_ball_by_ball — specialist sub-agent for ball-level analytics.
 *
 * Why a separate sub-agent and not just adding match_ball to ask_db's
 * allowlist:
 *
 * BBB queries return ~250–500 rows per innings. Even narrowed to a single
 * player, "all balls Phil faced this season" is plausibly 800+ rows. We
 * don't want that landing in the main ask_db loop, polluting the schema
 * dump for *every* unrelated SQL question, and tempting the agent to
 * select * from match_ball when the user asked something far simpler.
 *
 * Isolation: same as ask_db — failed queries, schema dumps, and row
 * samples never reach the main chat agent. Only the structured
 * { summary, rows, ... } envelope crosses the boundary, and the rows are
 * pre-narrowed by the sub-agent's SELECT before they leave.
 */
export function createAskBallByBallTool(deps: AskBallByBallToolDeps) {
  const { model } = resolveModel(deps.provider, deps.modelId);

  return {
    ask_ball_by_ball: tool({
      description: `Answer a ball-level question about Percy Main innings, dismissals, or bowling spells. Pass a natural-language question; a SQL specialist runs the queries against the ball-by-ball tables and returns rows + a short \`summary\` describing the FETCHING PROCESS, not a narrative of the data.

Use ONLY when the question is genuinely ball-level. The general-purpose ask_db tool covers everything else (career stats, team form, fixtures, season aggregates, etc.).

GOOD fits for ask_ball_by_ball:
  - "Walk me through Phil's 47 last Saturday — how did he build it, who bowled at him, how did he get out?"
  - "Show me the 20 balls leading up to each of my dismissals this season."
  - "What's my dot-ball % when bowling first change vs death overs?"
  - "Did I score a boundary in the over before getting out, on average?"
  - "Who has my best bowling spell this year — link the moment of the wicket if it's on video."

BAD fits — use ask_db instead:
  - "How many runs did Phil score this season?" → batting career stat, ask_db
  - "Who's our best bowler?" → season aggregate, ask_db
  - "What's our W/L record at home?" → match-level stat, ask_db

Coverage caveat: only matches that were live-scored on Play Cricket appear here — currently a subset of fixtures. If a query returns no rows for a specific match, it's likely a "no live scoring" case rather than a missing player.`,
      inputSchema: z.object({
        question: z
          .string()
          .min(3)
          .describe(
            "Plain-English question. Be specific (player name, match date or id, season) — the sub-agent has no chat context. If you want to deep-link a video moment, say so explicitly so it joins match_stream.",
          ),
      }),
      execute: async ({ question }) => {
        const tools = createDbTools({
          dbReadonly: deps.dbReadonly,
          allowedTables: ASK_BBB_ALLOWED_TABLES,
        });

        const today = new Date();
        const iso = today.toISOString().slice(0, 10);
        const ddmmyyyy = today.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });

        const system = `You are a SQL fetcher for Percy Main CSC's ball-by-ball data (PostgreSQL, public schema, read-only).

Your job: run SELECT queries that ANSWER the question, and return the rows. A separate downstream agent reads your rows and writes the prose reply with cricket context — you do NOT write that prose yourself. Your final reply text is consumed as a short metadata note about the FETCHING PROCESS, not as a narrative of the data.

Today is ${iso} (${ddmmyyyy} dd/mm/yyyy). Current season is ${today.getFullYear()}.

Tables available (call db_list_tables for the full schema, db_describe_table for one table):
${ASK_BBB_ALLOWED_TABLES.map((t) => `  - ${t}`).join("\n")}

CRITICAL — schema gotchas specific to BBB:

1. **Player ids on match_ball are RV-native ints, not Play Cricket text ids.** Columns: batter_rv_id, batter_ns_rv_id, bowler_rv_id, dismissed_batter_rv_id. To filter by a player you know by name or PC id, join via rv_player_mapping.rv_player_id ↔ match_ball.{batter,bowler,...}_rv_id; rv_player_mapping.pc_player_id then joins to scout_member.play_cricket_id. Doing it the other way round (joining scout_member directly to match_ball) WILL NOT WORK — there's no shared id type.

2. **ball_no includes extras; ball_no_disp does not.** Use ball_no for chronological ordering inside an innings (it's the natural key). Use ball_no_disp when reporting "the 7th legal delivery of the over". Both are 1-based per innings.

3. **Dismissal mode is NOT in match_ball.** RV's ball feed only flags "dismissed" via dismissed_batter_rv_id; how_out (caught/bowled/lbw/run-out/etc.) lives in match_performance_batting for OUR players only. To filter dismissals by mode: join match_performance_batting on (match_id, player_id = rv_player_mapping.pc_player_id). For OPPOSITION batters, mode is unavailable — return rows with how_out IS NULL and note this in the summary.

4. **Video deep-link.** youtu.be/{match_stream.video_id}?t={match_ball.ball_offset_seconds}s gives a per-ball deep link. ball_offset_seconds is null when no stream existed for the match; in that case omit the URL. Don't fabricate a stream.

5. **match_date is text in ISO YYYY-MM-DD** on match_result and match_performance_batting; lex order matches chronological order, so ORDER BY / WHERE / BETWEEN on the text column work. Compare against today as '${iso}' (or current_date::text).

6. **Aggregate in SQL, never in your head.** Strike rate, dot-ball %, false-shot proxies, leading-up-to-dismissal windows — write a query that COMPUTES the answer. Pulling 300 raw balls back to count dots is wasteful and inaccurate.

7. **Stop when the rows are right.** After the final db_run_sql call has the answer rows, write your short metadata reply and STOP. You have ${String(deps.maxSteps)} steps total.

8. **NEVER silently substitute a different filter.** If the user asks for 2026 and 2026 has no live-scored matches, return ZERO rows with a summary like "No live-scored matches in 2026 for this player." DO NOT widen to 2025 and return those as if they were the answer.

OUTPUT — what to write as your final reply:

The summary is read by the OUTER agent, which is schema-blind by design. NEVER name a table, column, or any other piece of database structure in the summary — those are your implementation details. Phrase everything in cricket terms (balls, innings, dismissals, bowlers, batters, deep-links).

DO write (one short sentence, sometimes two):
  - filters and assumptions you applied, in cricket terms: "Filtered to balls Phil faced in match 7262912; 32 balls across 1 innings."
  - schema choices, abstracted: "Joined the dismissal mode from the match scorecard." — never name the column.
  - failure path: "No live-scored matches for 'Bob Smith' in 2026; he may not have played in matches with electronic scoring."

DO NOT write:
  - any table or column name (no match_ball, rv_player_mapping, ball_offset_seconds, batter_rv_id, etc.)
  - rankings, "highlights", or commentary on the rows
  - markdown tables of the rows (the downstream agent formats those)
  - restating the question
  - empty filler ("Here are the results.")

If the rows are the entire answer (e.g. a count of 32), just say what filter you used — do NOT also say "the answer is 32", that's the rows' job.`;

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
            "ask_ball_by_ball: sub-agent generateText failed",
          );
          return {
            error:
              "Ball-by-ball query helper failed. Try rephrasing the question or ask again in a moment.",
          };
        }

        // Walk the steps for the last successful db_run_sql tool result —
        // that's the query that produced the answer. Mirrors ask_db.
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
            event: "scout.ask_ball_by_ball",
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
          "scout: ask_ball_by_ball sub-agent done",
        );

        const rawSummary = result.text.trim();

        const lastStep = result.steps[result.steps.length - 1];
        const cutOff =
          lastStep?.finishReason === "tool-calls" ||
          lastStep?.finishReason === "length" ||
          looksLikePlanningProse(rawSummary);

        let summary = cutOff ? "" : rawSummary;
        if (summary) {
          const { masked, tablesFound } = maskTableNames(
            summary,
            ASK_BBB_ALLOWED_TABLES,
          );
          if (tablesFound.length > 0) {
            deps.logger?.warn(
              {
                event: "scout.ask_ball_by_ball.summary_named_tables",
                tablesFound,
                originalSummary: summary,
              },
              "ask_ball_by_ball: sub-agent named tables in summary; masked before returning",
            );
          }
          summary = masked;
        }

        if (!summary && !lastSql) {
          return {
            error:
              "Ball-by-ball query helper returned no answer. The question may be ambiguous; try rephrasing.",
          };
        }

        if (lastSql) {
          if (cutOff) {
            deps.logger?.warn(
              {
                event: "scout.ask_ball_by_ball.cut_off_mid_loop",
                stepCount,
                maxSteps: deps.maxSteps,
                lastFinishReason: lastStep?.finishReason,
                rawSummary,
              },
              "ask_ball_by_ball: sub-agent ran out of steps mid-loop; rows are from the last successful query but may be incomplete",
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

        // Sub-agent emitted a summary but never ran SQL. Mirror ask_db's
        // structured-error behaviour rather than returning empty rows.
        const { masked: maskedRawSummary, tablesFound: rawTablesFound } =
          maskTableNames(rawSummary, ASK_BBB_ALLOWED_TABLES);
        deps.logger?.warn(
          {
            event: "scout.ask_ball_by_ball.no_sql_run",
            question,
            stepCount,
            rawSummary,
            tablesFound: rawTablesFound,
            maxSteps: deps.maxSteps,
            lastFinishReason: lastStep?.finishReason,
          },
          "ask_ball_by_ball: sub-agent finished without running any SQL",
        );
        return {
          error: `Ball-by-ball query helper finished without running SQL (in ${String(stepCount)} step${stepCount === 1 ? "" : "s"} of ${String(deps.maxSteps)}). Sub-agent's last note: ${maskedRawSummary || "(empty)"}. Try a more specific question or wait for the next step.`,
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
