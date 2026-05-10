import type { DB } from "@percy-main/db";
import type { ScoutReportPayload } from "@percy-main/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import type { Config } from "../../../config.ts";
import type { ScoutReportStore } from "../../../lib/s3-scout-reports.ts";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { CitationAccumulator } from "./citation-accumulator.ts";
import { renderScoutReportPdf } from "./render.ts";
import { runReportAgent } from "./report-agent.ts";

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
  logger: FastifyBaseLogger;
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

const FLUSH_INTERVAL_MS = 1500;

/**
 * Run the full scout-report pipeline (agent → render → S3 → persist) against
 * a queued `scout_report` row. The FE polls `GET /api/scout/reports/:id` and
 * shows a single loading box driven by `status` and `started_at`.
 *
 * Idempotent: a re-launch finding a non-`queued` row exits cleanly without
 * touching it.
 *
 * Cancellation: a periodic flush reads `cancel_requested`. If set, the agent's
 * AI SDK loop is aborted via the worker-level AbortController and a
 * `ReportCancelledError` is recorded as the row's failure cause.
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
  const startedAt = Date.now();
  const claimed = await db
    .updateTable("scout_report")
    .set({ status: "generating", started_at: new Date(startedAt) })
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
    logger.warn(
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
  const citations = new CitationAccumulator();

  // Background poller for cancel_requested. Single-purpose: if set, abort
  // the agent loop. No periodic progress writes — there are no phases to
  // persist any more, and the FE elapsed-time counter runs off started_at.
  const flush = async (): Promise<void> => {
    try {
      const r = await db
        .selectFrom("scout_report")
        .select("cancel_requested")
        .where("id", "=", reportId)
        .executeTakeFirst();
      if (r?.cancel_requested) {
        abortController.abort(new ReportCancelledError());
      }
    } catch (err) {
      logger.warn({ err, reportId }, "scout_report_flush_failed");
    }
  };

  const interval = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  /**
   * Re-read cancel_requested between phases. The agent loop honours the
   * AbortController via cancelSignal, but render / S3 / final-update are
   * non-cancellable from the AI SDK's perspective — without these checks,
   * a captain hitting Stop during the 10–30s render still produces a
   * "ready" PDF. Throws ReportCancelledError, which the outer catch
   * classifies as a clean cancel rather than a failure.
   */
  const checkCancel = async (): Promise<void> => {
    if (abortController.signal.aborted) throw new ReportCancelledError();
    const r = await db
      .selectFrom("scout_report")
      .select("cancel_requested")
      .where("id", "=", reportId)
      .executeTakeFirst();
    if (r?.cancel_requested) throw new ReportCancelledError();
  };

  try {
    const { content, chartSpecs } = await runReportAgent(
      {
        db,
        dbReadonly: deps.dbReadonly,
        playCricket: deps.playCricket,
        config: deps.config,
        voyage: deps.voyage,
        userId: row.user_id,
        logger,
        cancelSignal: abortController.signal,
      },
      params,
      citations,
    );

    await checkCancel();

    // Server-side fills references from the citations gathered during the run.
    // accumulator.toContent() already initialises references to []; we overwrite
    // here from the citation accumulator's snapshot.
    const match = `${params.ourTeam} ${params.homeAway === "home" ? "vs" : "at"} ${params.opposition}`;
    const payload: ScoutReportPayload = {
      ...content,
      references: citations.snapshot(),
      match,
      matchDate: params.matchDate,
    };

    await db
      .updateTable("scout_report")
      .set({ status: "rendering" })
      .where("id", "=", reportId)
      .execute();

    const pdf = await renderScoutReportPdf(payload, chartSpecs);
    // Last cancel checkpoint before we commit to S3. After the put, a
    // cancel that arrives mid-flight has to clean up the orphan; the
    // outer catch handles that via the existing s3 cleanup path on the
    // failed-update branch.
    await checkCancel();
    const s3Key = await deps.scoutReports.putReport(reportId, pdf);

    try {
      await db
        .updateTable("scout_report")
        .set({
          status: "ready",
          s3_key: s3Key,
          file_size_bytes: pdf.length,
        })
        .where("id", "=", reportId)
        .execute();
    } catch (updateErr) {
      try {
        await deps.scoutReports.deleteReport(s3Key);
      } catch (cleanupErr) {
        logger.warn(
          { err: cleanupErr, reportId, s3Key },
          "scout_report_s3_cleanup_after_db_failure_also_failed; lifecycle rule will sweep",
        );
      }
      throw updateErr;
    }

    logger.info(
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

    await db
      .updateTable("scout_report")
      .set({ status: "failed", error_message: message })
      .where("id", "=", reportId)
      .execute()
      .catch((dbErr: unknown) => {
        logger.error(
          { err: dbErr, reportId },
          "scout_report_failed_status_update_failed",
        );
      });

    if (cancelled) {
      logger.info({ reportId }, "scout_report_cancelled");
      return;
    }
    logger.error(
      { err, reportId, ms: Date.now() - startedAt },
      "scout_report_failed",
    );
    throw err;
  } finally {
    clearInterval(interval);
  }
}
