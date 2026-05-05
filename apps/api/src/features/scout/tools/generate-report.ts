import type { DB } from "@percy-main/db";
import {
  scoutReportDisplayTitle,
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
      "Play Cricket match id for this fixture. From the upcoming-fixtures launcher message, or from ask_db / pc_find_opposition_matches.",
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

        // Construct the cover-page identifiers up front. These are derived
        // from the tool input, not from the researcher's output, so we can
        // also use them for the placeholder card title before the researcher
        // has produced anything.
        const match = `${input.ourTeam} ${input.homeAway === "home" ? "vs" : "at"} ${input.opposition}`;
        const displayTitle = scoutReportDisplayTitle({
          match,
          matchDate: input.matchDate,
        });

        const reportId = randomUUID();
        const createdAtIso = new Date().toISOString();

        // Stream the placeholder card immediately. Researcher loop + PDF
        // render is 30–90s; without this the FE shows nothing until the tool
        // result lands.
        writer.write({
          type: "data-report",
          id: reportId,
          data: {
            reportId,
            title: displayTitle,
            fileSizeBytes: null,
            createdAt: createdAtIso,
            status: "generating",
          },
        });

        try {
          // Phase 1 — researcher: tool-enabled, gathers evidence packet.
          const evidence = await researchScoutReport(
            {
              db,
              dbReadonly,
              playCricket,
              config,
              voyage,
              userId,
              logger,
            },
            input,
          );

          // Phase 2 — analyst: no tools, synthesises content + claims registry
          // from the evidence. Validators reject ungrounded mechanics claims;
          // one retry is built in.
          const analysed = await analyseScoutEvidence(
            { config, logger },
            input,
            evidence,
          );

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

          writer.write({
            type: "data-report",
            id: reportId,
            data: {
              reportId,
              title: displayTitle,
              fileSizeBytes: pdf.length,
              createdAt: createdAtIso,
              status: "ready",
            },
          });

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
          writer.write({
            type: "data-report",
            id: reportId,
            data: {
              reportId,
              title: displayTitle,
              fileSizeBytes: null,
              createdAt: createdAtIso,
              status: "failed",
              errorMessage:
                err instanceof Error ? err.message : "Unknown error",
            },
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
