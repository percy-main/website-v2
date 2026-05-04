import type { DB } from "@percy-main/db";
import {
  scoutReportPayloadSchema,
  type ScoutReportPayload,
} from "@percy-main/shared";
import { tool, type UIMessageStreamWriter } from "ai";
import type { FastifyBaseLogger } from "fastify";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ScoutReportStore } from "../../../lib/s3-scout-reports.ts";
import { renderScoutReportPdf } from "../report/render.ts";

export interface GenerateReportToolDeps {
  db: Kysely<DB>;
  scoutReports: ScoutReportStore;
  writer: UIMessageStreamWriter;
  userId: string;
  threadId: string;
  logger?: FastifyBaseLogger;
}

// Anthropic requires the top-level input_schema to be an object. Wrap the
// payload so JSON-schema generation produces { properties: { report: {...} } }.
const generateReportInputSchema = z.object({
  report: scoutReportPayloadSchema,
});

export function createGenerateReportTool(deps: GenerateReportToolDeps) {
  const { db, scoutReports, writer, userId, threadId, logger } = deps;

  return {
    generate_report: tool({
      description: `Generate a polished PDF scouting report based on the conversation so far, save it to durable storage, and surface a download card inline in the chat.

Call this AT MOST ONCE per scouting session, only after you have gathered enough material — usually a mix of weather (weather_get), our players (ask_db for selection and match_performance_* aggregates), opposition (pc_match_summary, pc_player_stats), and any club facts (fact_retrieve). If you don't have enough information yet, gather more first; do not produce a stub report.

Structure your payload to match the schema exactly:

- title: include the team, opposition, and date.
- intro: 1–2 paragraphs naming the match, format, opposition, why it matters.
- weather: pass through the forecast you fetched. retrievedAt should be the timestamp from your weather_get call.
- ourPlayers: every selected player you have data on. role + 1–3 sentence notes + key stats. Pull stats from ask_db (questions like "give me Smith's 2025 batting average and HS", "list this Saturday's selected XI with their season stats").
- ourPlayersCharts: 0–4 charts (Chart.js v4 specs, same shape as chart_render).
- theirPlayers / theirPlayersCharts: opposition equivalents.
- tactics: toss call, batting/bowling order intentions, fielding plans, matchup-specific notes. Markdown allowed inside paragraphs but no headings.
- conclusion: short, encouraging close. Do NOT include "Up The Main" — the renderer appends it.
- references: every URL you fetched while building this. Required, not optional. Include scorecard URLs, weather URLs, fact source URLs.

The PDF is uploaded to S3 and a download card streams back to the user. After this tool returns, do NOT also dump the report content as prose — the user has the PDF. A one-line confirmation is enough.`,
      inputSchema: generateReportInputSchema,
      execute: async ({ report }: { report: ScoutReportPayload }) => {
        const startedAt = Date.now();

        // Generate the id up-front so we can use it as the streaming part
        // id (so the placeholder card and the ready card are addressable
        // by the same id) AND as the eventual DB primary key once the row
        // is inserted post-upload. No DB row exists during generation, so
        // there's no half-state for the listing/download routes to trip
        // over.
        const reportId = randomUUID();
        const createdAtIso = new Date().toISOString();

        // Stream the placeholder card immediately. PDF rendering is
        // synchronous and CPU-heavy (chart canvases + react-pdf layout) so
        // without this the FE shows nothing until the tool result lands —
        // ~10–30s of dead air on a real report.
        writer.write({
          type: "data-report",
          id: reportId,
          data: {
            reportId,
            title: report.title,
            fileSizeBytes: null,
            createdAt: createdAtIso,
            status: "generating",
          },
        });

        try {
          const pdf = await renderScoutReportPdf(report);
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
                title: report.title,
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

          // Re-emit with the same id so the FE replaces the placeholder
          // card with the ready-to-download card in place.
          writer.write({
            type: "data-report",
            id: reportId,
            data: {
              reportId,
              title: report.title,
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
          // Flip the placeholder to a failure state so the FE replaces the
          // spinner with an error card rather than a stuck "Generating…".
          writer.write({
            type: "data-report",
            id: reportId,
            data: {
              reportId,
              title: report.title,
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
