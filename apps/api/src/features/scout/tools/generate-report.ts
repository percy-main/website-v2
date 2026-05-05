import type { DB } from "@percy-main/db";
import {
  scoutReportDisplayTitle,
  type ReportData,
  type ReportPhaseName,
  type ReportPhaseState,
  type ReportToolCallEvent,
  type ScoutReportPayload,
} from "@percy-main/shared";
import { tool, type UIMessageStreamWriter } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../../../config.ts";
import type { ScoutReportStore } from "../../../lib/s3-scout-reports.ts";
import type { PlayCricketApiClient } from "../../play-cricket/api-client.ts";
import type { VoyageClient } from "../facts/voyage.ts";
import { analyseScoutEvidence } from "../report/analyst.ts";
import { renderScoutReportPdf } from "../report/render.ts";
import { researchScoutReport } from "../report/researcher.ts";

export interface GenerateReportToolDeps {
  db: Kysely<DB>;
  // Researcher needs the read-only DB pool for ask_db, the play-cricket client
  // for pc_*, the model config to resolve its provider, and optional voyage
  // for fact_retrieve. All threaded through from the agent factory.
  dbReadonly: Kysely<DB>;
  playCricket: PlayCricketApiClient;
  config: Config;
  voyage?: VoyageClient;
  scoutReports: ScoutReportStore;
  writer: UIMessageStreamWriter;
  userId: string;
  threadId: string;
  logger?: FastifyBaseLogger;
}

const generateReportInputSchema = z.object({
  matchId: z
    .string()
    .min(1)
    .describe(
      "Play Cricket match id for this fixture. From the upcoming-fixtures launcher message, or from ask_db / ask_play_cricket.",
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
  } = deps;

  return {
    generate_report: tool({
      description: `Generate a polished PDF scouting report for a specific upcoming match, save it to durable storage, and surface a download card inline in the chat.

Call this AT MOST ONCE per session. The input is just the match identifiers — NOT the report content. A researcher sub-agent runs behind this tool and gathers everything (selection, opposition stats, weather, facts) itself; do not stream stats or analysis into these args.

Required:
- matchId: the Play Cricket match id (from the upcoming-fixtures launcher message, or from ask_db on availability_fixture).
- ourTeam: our team name, e.g. 'Percy Main 1st XI'.
- opposition: opposition team name.
- homeAway: 'home' or 'away'.
- matchDate: display-formatted date, e.g. '10 May 2026'.

Optional:
- competition: league or cup name if you know it.
- intent: a one-line scouting angle if the captain has a specific focus (otherwise omit and the researcher does a balanced report).

After this returns, a one-line confirmation is enough. Do NOT dump the report content — the user has the PDF.`,
      inputSchema: generateReportInputSchema,
      execute: async (input: GenerateReportInput) => {
        const startedAt = Date.now();

        // Cover-page identifiers up front — derived from input, not from any
        // model output, so we can label the placeholder card immediately.
        const match = `${input.ourTeam} ${input.homeAway === "home" ? "vs" : "at"} ${input.opposition}`;
        const displayTitle = scoutReportDisplayTitle({
          match,
          matchDate: input.matchDate,
        });

        const reportId = randomUUID();
        const createdAtIso = new Date().toISOString();

        // Per-phase state we mutate in place as the flow advances. Each
        // mutation is followed by an emit() to push the snapshot to the FE.
        const phases: Record<ReportPhaseName, ReportPhaseState> = {
          researcher: { state: "pending" },
          analyst: { state: "pending" },
          render: { state: "pending" },
        };
        const recentToolCalls: ReportToolCallEvent[] = [];
        const RECENT_CHIP_CAP = 6;

        // Tool calls we expose to the FE as fly-out chips. record_evidence
        // fires constantly during the researcher loop and is plumbing rather
        // than narrative, so we filter it out. The pc_* tools fire INSIDE
        // the ask_play_cricket sub-agent and never reach this stream, so
        // they're absent here — the user sees one ask_play_cricket chip per
        // PC question instead of a fan-out of projection calls.
        const CHIP_TOOL_ALLOWLIST = new Set([
          "ask_db",
          "ask_play_cricket",
          "weather_get",
          "weather_geocode",
          "fact_retrieve",
        ]);

        const buildSnapshot = (
          status: ReportData["status"],
          extras: Partial<ReportData> = {},
        ): ReportData => ({
          reportId,
          title: displayTitle,
          fileSizeBytes: null,
          createdAt: createdAtIso,
          status,
          startedAt,
          phases: { ...phases },
          recentToolCalls: recentToolCalls.slice(-RECENT_CHIP_CAP),
          ...extras,
        });

        const emit = (
          status: ReportData["status"],
          extras: Partial<ReportData> = {},
        ) => {
          writer.write({
            type: "data-report",
            id: reportId,
            data: buildSnapshot(status, extras),
          });
        };

        // Initial paint: researcher active, two phases pending.
        phases.researcher = { state: "active", startedAt: Date.now() };
        emit("generating");

        try {
          // ── Phase 1: researcher ────────────────────────────────────────
          const evidence = await researchScoutReport(
            {
              db,
              dbReadonly,
              playCricket,
              config,
              voyage,
              userId,
              logger,
              onStep: ({ step, toolNames }) => {
                let mutated = false;
                toolNames.forEach((toolName, idx) => {
                  if (!CHIP_TOOL_ALLOWLIST.has(toolName)) return;
                  recentToolCalls.push({
                    id: `researcher-${step}-${idx}`,
                    phase: "researcher",
                    toolName,
                    at: Date.now(),
                  });
                  mutated = true;
                });
                if (mutated) emit("generating");
              },
            },
            input,
          );

          phases.researcher = {
            state: "done",
            startedAt: phases.researcher.startedAt,
            endedAt: Date.now(),
            summary: { records: evidence.length },
          };
          phases.analyst = { state: "active", startedAt: Date.now() };
          emit("generating");

          // ── Phase 2: analyst ───────────────────────────────────────────
          const analysed = await analyseScoutEvidence(
            {
              config,
              logger,
              onAttempt: ({ attempt, ms, ok }) => {
                logger?.info(
                  { reportId, attempt, ms, ok },
                  "scout_report_analyst_attempt",
                );
              },
            },
            input,
            evidence,
          );

          phases.analyst = {
            state: "done",
            startedAt: phases.analyst.startedAt,
            endedAt: Date.now(),
            summary: { claims: analysed.claims.length },
          };
          phases.render = { state: "active", startedAt: Date.now() };
          emit("generating");

          // ── Phase 3: render + persist ─────────────────────────────────
          const payload: ScoutReportPayload = {
            ...analysed.content,
            match,
            matchDate: input.matchDate,
          };

          const pdf = await renderScoutReportPdf(payload);
          const s3Key = await scoutReports.putReport(reportId, pdf);

          // Insert *after* the upload succeeds, with the explicit id we
          // streamed to the FE. If the DB insert fails, clean up the S3
          // object so we don't leak a paid-for orphan.
          try {
            await db
              .insertInto("scout_report")
              .values({
                id: reportId,
                user_id: userId,
                thread_id: threadId,
                title: displayTitle,
                s3_key: s3Key,
                file_size_bytes: pdf.length,
              })
              .execute();
          } catch (insertErr) {
            try {
              await scoutReports.deleteReport(s3Key);
            } catch (cleanupErr) {
              logger?.warn(
                { err: cleanupErr, s3Key },
                "scout report S3 cleanup after DB insert failure also failed; lifecycle rule will sweep",
              );
            }
            throw insertErr;
          }

          phases.render = {
            state: "done",
            startedAt: phases.render.startedAt,
            endedAt: Date.now(),
            summary: { bytes: pdf.length },
          };

          emit("ready", { fileSizeBytes: pdf.length });

          logger?.info(
            { reportId, bytes: pdf.length, ms: Date.now() - startedAt },
            "scout_report_generated",
          );

          return {
            generated: true,
            reportId,
            fileSizeBytes: pdf.length,
          };
        } catch (err) {
          // Mark whichever phase was active at failure time. The FE keeps the
          // pipeline visible so the user sees which step broke.
          const activePhase = (
            ["render", "analyst", "researcher"] as const
          ).find((p) => phases[p].state === "active");
          if (activePhase) {
            phases[activePhase] = {
              state: "failed",
              startedAt: phases[activePhase].startedAt,
              endedAt: Date.now(),
            };
          }
          emit("failed", {
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          });
          logger?.error(
            { err, ms: Date.now() - startedAt },
            "scout_report_failed",
          );
          throw err;
        }
      },
    }),
  };
}

export type GenerateReportTools = ReturnType<typeof createGenerateReportTool>;
