import type { DB } from "@percy-main/db";
import {
  type ReportPhaseName,
  type ReportPhaseState,
  type ReportToolCallEvent,
  type ScoutLeagueTable,
  type ScoutReportPayload,
} from "@percy-main/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../../config.ts";
import type { ScoutReportStore } from "../../../lib/s3-scout-reports.ts";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { analyseScoutEvidence } from "./analyst.ts";
import type { EvidenceRecord } from "./evidence.ts";
import { renderScoutReportPdf } from "./render.ts";
import { researchScoutReport } from "./researcher.ts";

/**
 * Pull the structured league table off the first league_standings evidence
 * record. Returns undefined for cup matches (researcher emits no such record)
 * or when the researcher emitted league_standings without populating the
 * structured field — better to drop the table than ship something half-built.
 *
 * Exported for unit testing.
 */
export function extractLeagueTable(
  evidence: EvidenceRecord[],
): ScoutLeagueTable | undefined {
  const record = evidence.find((e) => e.claimType === "league_standings");
  return record?.leagueTable;
}

export interface RunReportDeps {
  /** Main read/write pool — used for scout_report orchestration UPDATEs and
   *  for tools that legitimately need writes (cache, fact_record). */
  db: Kysely<DB>;
  /** Read-only pool — passed to ask_db so the LLM cannot author
   *  destructive SQL. Falls back to `db` only as a dev convenience. */
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  voyage?: VoyageClient;
  scoutReports: ScoutReportStore;
  logger?: FastifyBaseLogger;
}

export class ReportCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "ReportCancelledError";
  }
}

export class ReportNotFoundError extends Error {
  constructor(reportId: string) {
    super(`scout_report ${reportId} not found`);
    this.name = "ReportNotFoundError";
  }
}

export class ReportNotRunnableError extends Error {
  constructor(reportId: string, reason: string) {
    super(`scout_report ${reportId} not runnable: ${reason}`);
    this.name = "ReportNotRunnableError";
  }
}

const RECENT_CHIP_CAP = 6;
const FLUSH_INTERVAL_MS = 1500;

// Tool calls we surface to the FE as fly-out chips. record_evidence fires
// constantly during the researcher loop and is plumbing rather than narrative.
// The pc_* tools now run directly in the researcher loop (no ask_play_cricket
// sub-agent wrapping them), so each call is a real research step worth showing.
const CHIP_TOOL_ALLOWLIST = new Set([
  "ask_db",
  "pc_match_summary",
  "pc_match_detail",
  "pc_league_table",
  "pc_site_matches",
  "pc_site_results",
  "pc_find_opposition_matches",
  "pc_list_players",
  "weather_get",
  "weather_geocode",
  "fact_retrieve",
]);

interface PersistedProgress {
  phases: Record<ReportPhaseName, ReportPhaseState>;
  recentToolCalls: ReportToolCallEvent[];
}

const initialProgress = (): PersistedProgress => ({
  phases: {
    researcher: { state: "pending" },
    analyst: { state: "pending" },
    render: { state: "pending" },
  },
  recentToolCalls: [],
});

/**
 * Run the full scout-report pipeline (researcher → analyst → render → S3 →
 * persist) against a queued `scout_report` row. All progress is persisted
 * back to the row — the FE polls `GET /api/scout/reports/:id` to surface it.
 *
 * Idempotent: a re-launch finding a non-`queued` row exits cleanly without
 * touching it.
 *
 * Cancellation: a periodic flush reads `cancel_requested`. If set, the
 * researcher's AI SDK loop is aborted via the worker-level AbortController
 * and a `ReportCancelledError` is recorded as the row's failure cause.
 */
export async function runReport(
  deps: RunReportDeps,
  reportId: string,
): Promise<void> {
  const { db, logger } = deps;

  // Atomic claim. ECS RunTask is at-least-once, so two workers can pick up
  // the same reportId at the same moment. The UPDATE ... WHERE status =
  // 'queued' RETURNING ... pattern lets exactly one of them transition the
  // row out of 'queued'; the loser sees an empty result and exits cleanly.
  // Replaces an earlier read-then-update sequence that had a TOCTOU race.
  const startedAt = Date.now();
  const claimed = await db
    .updateTable("scout_report")
    .set({ status: "researching", started_at: new Date(startedAt) })
    .where("id", "=", reportId)
    .where("status", "=", "queued")
    .returning([
      "id",
      "user_id",
      "thread_id",
      "match_id",
      "our_team",
      "opposition",
      "match_date",
      "home_away",
      "competition",
      "intent",
    ])
    .executeTakeFirst();

  if (!claimed) {
    // Two cases collapse here: the row doesn't exist, or it does but
    // someone else already claimed it / it's already finished. Both are
    // no-op outcomes for this worker — the row, if any, isn't ours to run.
    const existing = await db
      .selectFrom("scout_report")
      .select("status")
      .where("id", "=", reportId)
      .executeTakeFirst();
    if (!existing) throw new ReportNotFoundError(reportId);
    logger?.warn(
      { reportId, status: existing.status },
      "scout_report_worker_skip_already_claimed_or_finished",
    );
    return;
  }

  const row = claimed;

  if (
    !row.match_id ||
    !row.our_team ||
    !row.opposition ||
    !row.match_date ||
    !row.home_away ||
    !row.user_id
  ) {
    throw new ReportNotRunnableError(
      reportId,
      "missing one or more scope columns (match_id, our_team, opposition, match_date, home_away, user_id)",
    );
  }

  const params = {
    matchId: row.match_id,
    ourTeam: row.our_team,
    opposition: row.opposition,
    matchDate: row.match_date,
    homeAway: row.home_away as "home" | "away",
    competition: row.competition ?? undefined,
    intent: row.intent ?? undefined,
  };
  const abortController = new AbortController();
  const progress = initialProgress();
  let progressDirty = false;

  const writeProgress = async (
    extras: { status?: string; started_at?: Date } = {},
  ): Promise<void> => {
    await db
      .updateTable("scout_report")
      .set({
        ...(extras.status ? { status: extras.status } : {}),
        ...(extras.started_at ? { started_at: extras.started_at } : {}),
        phases: JSON.stringify(progress),
      })
      .where("id", "=", reportId)
      .execute();
    progressDirty = false;
  };

  const flush = async (): Promise<void> => {
    try {
      const r = await db
        .selectFrom("scout_report")
        .select("cancel_requested")
        .where("id", "=", reportId)
        .executeTakeFirst();
      if (r?.cancel_requested) {
        abortController.abort(new ReportCancelledError());
        return;
      }
      if (progressDirty) await writeProgress();
    } catch (err) {
      logger?.warn({ err, reportId }, "scout_report_flush_failed");
    }
  };

  const interval = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  const checkCancelBetweenPhases = async (): Promise<void> => {
    const r = await db
      .selectFrom("scout_report")
      .select("cancel_requested")
      .where("id", "=", reportId)
      .executeTakeFirst();
    if (r?.cancel_requested) throw new ReportCancelledError();
  };

  try {
    // status + started_at were already set by the atomic claim above; this
    // first write only persists the initial `phases` snapshot.
    progress.phases.researcher = { state: "active", startedAt: Date.now() };
    await writeProgress();

    const evidence = await researchScoutReport(
      {
        db,
        dbReadonly: deps.dbReadonly,
        playCricket: deps.playCricket,
        config: deps.config,
        voyage: deps.voyage,
        userId: row.user_id,
        logger,
        cancelSignal: abortController.signal,
        onStep: ({ step, toolNames }) => {
          let mutated = false;
          toolNames.forEach((toolName, idx) => {
            if (!CHIP_TOOL_ALLOWLIST.has(toolName)) return;
            progress.recentToolCalls.push({
              id: `researcher-${step}-${idx}`,
              phase: "researcher",
              toolName,
              at: Date.now(),
            });
            mutated = true;
          });
          if (progress.recentToolCalls.length > RECENT_CHIP_CAP) {
            progress.recentToolCalls =
              progress.recentToolCalls.slice(-RECENT_CHIP_CAP);
          }
          if (mutated) progressDirty = true;
        },
      },
      params,
    );

    progress.phases.researcher = {
      state: "done",
      startedAt: progress.phases.researcher.startedAt,
      endedAt: Date.now(),
      summary: { records: evidence.length },
    };

    await checkCancelBetweenPhases();

    progress.phases.analyst = { state: "active", startedAt: Date.now() };
    await writeProgress({ status: "analysing" });

    const analysed = await analyseScoutEvidence(
      {
        config: deps.config,
        logger,
        onAttempt: ({ attempt, ms, ok }) => {
          logger?.info(
            { reportId, attempt, ms, ok },
            "scout_report_analyst_attempt",
          );
        },
      },
      params,
      evidence,
    );

    progress.phases.analyst = {
      state: "done",
      startedAt: progress.phases.analyst.startedAt,
      endedAt: Date.now(),
      summary: { claims: analysed.claims.length },
    };

    await checkCancelBetweenPhases();

    progress.phases.render = { state: "active", startedAt: Date.now() };
    await writeProgress({ status: "rendering" });

    const match = `${params.ourTeam} ${params.homeAway === "home" ? "vs" : "at"} ${params.opposition}`;
    const leagueTable = extractLeagueTable(evidence);
    const payload: ScoutReportPayload = {
      ...analysed.content,
      match,
      matchDate: params.matchDate,
      ...(leagueTable ? { leagueTable } : {}),
    };
    const pdf = await renderScoutReportPdf(payload);
    const s3Key = await deps.scoutReports.putReport(reportId, pdf);

    progress.phases.render = {
      state: "done",
      startedAt: progress.phases.render.startedAt,
      endedAt: Date.now(),
      summary: { bytes: pdf.length },
    };

    try {
      await db
        .updateTable("scout_report")
        .set({
          status: "ready",
          s3_key: s3Key,
          file_size_bytes: pdf.length,
          phases: JSON.stringify(progress),
        })
        .where("id", "=", reportId)
        .execute();
    } catch (updateErr) {
      try {
        await deps.scoutReports.deleteReport(s3Key);
      } catch (cleanupErr) {
        logger?.warn(
          { err: cleanupErr, reportId, s3Key },
          "scout_report_s3_cleanup_after_db_failure_also_failed; lifecycle rule will sweep",
        );
      }
      throw updateErr;
    }

    logger?.info(
      { reportId, bytes: pdf.length, ms: Date.now() - startedAt },
      "scout_report_generated",
    );
  } catch (err) {
    const cancelled =
      err instanceof ReportCancelledError ||
      (err instanceof Error &&
        err.name === "AbortError" &&
        abortController.signal.aborted);
    const message = cancelled
      ? "Cancelled"
      : err instanceof Error
        ? err.message
        : "Unknown error";

    const activePhase = (["render", "analyst", "researcher"] as const).find(
      (p) => progress.phases[p].state === "active",
    );
    if (activePhase) {
      progress.phases[activePhase] = {
        state: "failed",
        startedAt: progress.phases[activePhase].startedAt,
        endedAt: Date.now(),
      };
    }

    await db
      .updateTable("scout_report")
      .set({
        status: "failed",
        error_message: message,
        phases: JSON.stringify(progress),
      })
      .where("id", "=", reportId)
      .execute()
      .catch((dbErr: unknown) => {
        logger?.error(
          { err: dbErr, reportId },
          "scout_report_failed_status_update_failed",
        );
      });

    if (cancelled) {
      logger?.info({ reportId }, "scout_report_cancelled");
      return;
    }
    logger?.error(
      { err, reportId, ms: Date.now() - startedAt },
      "scout_report_failed",
    );
    throw err;
  } finally {
    clearInterval(interval);
  }
}
