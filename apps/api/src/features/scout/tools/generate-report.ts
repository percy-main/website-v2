import type { Tracer } from "@opentelemetry/api";
import type { DB } from "@percy-main/db";
import { scoutReportDisplayTitle, type ReportData } from "@percy-main/shared";
import { tool, type UIMessageStreamWriter } from "ai";
import type { FastifyBaseLogger } from "fastify";
import { type Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../../../config.ts";
import type { ScoutReportStore } from "../../../lib/s3-scout-reports.ts";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { launchScoutReport } from "../report/launch.ts";

export interface GenerateReportToolDeps {
  db: Kysely<DB>;
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  voyage?: VoyageClient;
  scoutReports: ScoutReportStore;
  writer: UIMessageStreamWriter;
  userId: string;
  threadId: string;
  logger: FastifyBaseLogger;
  phoenixTracer: Tracer;
}

const generateReportInputSchema = z.object({
  matchId: z
    .string()
    .min(1)
    .describe(
      "Play Cricket match id for this fixture. From the upcoming-fixtures launcher message, or from db_run_sql / pc_match_summary.",
    ),
  ourTeam: z
    .string()
    .min(1)
    .describe("Our team name, e.g. 'Percy Main 1st XI'."),
  opposition: z
    .string()
    .min(1)
    .describe("Opposition team name, e.g. 'Tynemouth 1st XI'."),
  homeAway: z
    .enum(["home", "away"])
    .describe("'home' if we host, 'away' if we travel."),
  matchDate: z
    .string()
    .min(1)
    .describe(
      "Display-formatted match date for the PDF cover, e.g. '10 May 2026'. Verbatim — already formatted.",
    ),
  competition: z
    .string()
    .optional()
    .describe(
      "Competition / league name, e.g. 'NTCL Division 1' or 'Thomas Wilson League Cup'. Optional.",
    ),
  intent: z
    .string()
    .optional()
    .describe(
      "Optional one-line scouting angle if the captain has a specific focus ('opposition's left-arm seamer', 'how do they handle spin'). Researcher uses this as a steer.",
    ),
});

type GenerateReportInput = z.infer<typeof generateReportInputSchema>;

/** Cap on simultaneously in-flight reports across the whole service. Above
 *  this, the tool surfaces ServiceBusyError and the agent tells the user to
 *  try again shortly. Picked to keep DeepSeek token spend bounded if a stuck
 *  report sits in researching/analysing. */
const MAX_INFLIGHT_REPORTS = 5;

export class ServiceBusyError extends Error {
  constructor() {
    super("Scout is busy generating other reports — try again shortly");
    this.name = "ServiceBusyError";
  }
}

export function createGenerateReportTool(deps: GenerateReportToolDeps) {
  const {
    db,
    dbReadonly,
    playCricket,
    config,
    voyage,
    scoutReports,
    writer,
    userId,
    threadId,
    logger,
    phoenixTracer,
  } = deps;

  return {
    generate_report: tool({
      description: `Queue a polished PDF scouting report for a specific upcoming match. The report runs in the background — typically 10–20 minutes — and the user is notified when ready.

Call this AT MOST ONCE per session. The input is just the match identifiers — NOT the report content. The queued job gathers everything (selection, opposition stats, weather, facts) itself; do not stream stats or analysis into these args.

Required:
- matchId: the Play Cricket match id (from the upcoming-fixtures launcher message, or from db_run_sql on availability_fixture).
- ourTeam: our team name, e.g. 'Percy Main 1st XI'.
- opposition: opposition team name.
- homeAway: 'home' or 'away'.
- matchDate: display-formatted date, e.g. '10 May 2026'.

Optional:
- competition: league or cup name if you know it.
- intent: a one-line scouting angle if the captain has a specific focus (otherwise omit and the report covers a balanced packet).

After this returns, a one-line confirmation is enough — say "Report queued — it'll appear in the Reports tab when ready." Do NOT stream stats or analysis afterwards.`,
      inputSchema: generateReportInputSchema,
      execute: async (input: GenerateReportInput) => {
        const reportId = randomUUID();
        const match = `${input.ourTeam} ${input.homeAway === "home" ? "vs" : "at"} ${input.opposition}`;
        const displayTitle = scoutReportDisplayTitle({
          match,
          matchDate: input.matchDate,
        });
        const createdAtIso = new Date().toISOString();

        // Concurrency gate + insert in one transaction. Default READ
        // COMMITTED isolation means two simultaneous calls could each see
        // the count under the cap and both insert, briefly overshooting
        // by one. At single-digit reports/week this is irrelevant; if it
        // ever matters we'd add SELECT FOR UPDATE on a sentinel row.
        try {
          await db.transaction().execute(async (trx) => {
            const inflight = await trx
              .selectFrom("scout_report")
              .where("status", "not in", ["ready", "failed"])
              .select(({ fn }) => fn.countAll<string>().as("c"))
              .executeTakeFirstOrThrow();
            if (Number(inflight.c) >= MAX_INFLIGHT_REPORTS) {
              throw new ServiceBusyError();
            }
            await trx
              .insertInto("scout_report")
              .values({
                id: reportId,
                user_id: userId,
                thread_id: threadId,
                title: displayTitle,
                status: "queued",
                match_id: input.matchId,
                our_team: input.ourTeam,
                opposition: input.opposition,
                match_date: input.matchDate,
                home_away: input.homeAway,
                competition: input.competition ?? null,
                intent: input.intent ?? null,
              })
              .execute();
          });
        } catch (err) {
          if (err instanceof ServiceBusyError) {
            logger?.warn(
              { reportId, userId, threadId },
              "scout_report_capacity_gate_rejected",
            );
          }
          throw err;
        }

        // Kick off the worker. ECS in prod, in-process in dev — either way
        // returns immediately; the row is the source of truth for progress.
        try {
          await launchScoutReport({
            config,
            inProcessDeps: {
              db,
              dbReadonly,
              playCricket,
              config,
              voyage,
              scoutReports,
              logger,
              phoenixTracer,
            },
            reportId,
          });
        } catch (launchErr) {
          // Roll back the gate row so the slot frees up immediately. Without
          // this a launch failure permanently leaves a 'queued' row counting
          // toward the cap until an operator clears it.
          await db
            .deleteFrom("scout_report")
            .where("id", "=", reportId)
            .execute()
            .catch((dbErr: unknown) => {
              logger?.error(
                { err: dbErr, reportId },
                "scout_report_gate_rollback_failed",
              );
            });
          throw launchErr;
        }

        // Marker for the assistant message — the FE polls
        // /api/scout/reports/:id from this reportId alone, so the part
        // payload only needs the bare minimum that survives a thread
        // reload (reportId, title, createdAt, queued status).
        // Minimal marker. Just enough to mount the FE pipeline card; the
        // card immediately polls /api/scout/reports/:id for live state and
        // ignores everything beyond reportId/title/createdAt here. Keeping
        // the part small means a stale persisted snapshot (after a thread
        // reload) doesn't get rendered as if it were authoritative.
        const initial: ReportData = {
          reportId,
          title: displayTitle,
          fileSizeBytes: null,
          createdAt: createdAtIso,
          status: "queued",
        };
        writer.write({ type: "data-report", id: reportId, data: initial });

        return {
          generated: false,
          status: "queued" as const,
          reportId,
        };
      },
    }),
  };
}

export type GenerateReportTools = ReturnType<typeof createGenerateReportTool>;
