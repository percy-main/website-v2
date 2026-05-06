import { z } from "zod";

// scoutReportContentSchema is the structured output the report agent returns
// at the end of its run — every section the PDF renders, plus the league
// table when applicable. scoutReportPayloadSchema extends it with the match
// identifiers known up front (passed to the agent, not authored by it).
//
// title is intentionally NOT in the schema. It's derived from match +
// matchDate via scoutReportDisplayTitle() — single source of truth, no
// duplication, no chance of the model fabricating a third variant.

const playerStatBlockSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("Stat label, e.g. 'Average', 'SR', 'Wickets'."),
  value: z.string().min(1).describe("Formatted value, e.g. '34.2' or '12*'."),
});

const playerSchema = z.object({
  name: z.string().min(1),
  role: z
    .string()
    .optional()
    .describe("e.g. 'Right-handed bat / off-spin', 'Wicketkeeper'. Optional."),
  notes: z
    .string()
    .optional()
    .describe(
      "1–3 sentences of analyst commentary (recent form, threats, weaknesses).",
    ),
  stats: z
    .array(playerStatBlockSchema)
    .max(8)
    .optional()
    .describe("Headline stats, max 8. Pick the most relevant for the matchup."),
});

const referenceSchema = z.object({
  label: z.string().min(1).describe("Short human label for the source."),
  url: z.url(),
});

// Charts reference a server-side accumulated Chart.js spec by id. The agent
// calls the chart_render tool (report mode) which stores the spec and returns
// a chartId; the model then references that id here. Keeps the JSON output
// compact — full Chart.js configs can be 1-2KB each and don't need to ride
// inside the structured-content payload.
const reportChartSchema = z.object({
  caption: z
    .string()
    .min(1)
    .describe("One-line caption explaining what the chart shows."),
  chartId: z
    .string()
    .min(1)
    .describe(
      "ID returned by the chart_render tool. The renderer looks up the spec by this id and rasterises it into the PDF.",
    ),
});

// Structured league table — the renderer's source of truth for W/L records.
// The model emits this directly in its ScoutReportContent JSON when it has
// fetched standings via pc_league_table. Absent for cup / friendly matches.
export const scoutLeagueTableSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      "Division / league name as it appears in Play Cricket, e.g. 'NTCL Premier Division'.",
    ),
  columns: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Column headers in display order, e.g. ['#', 'Team', 'P', 'W', 'L', 'T', 'Pts'].",
    ),
  rows: z
    .array(
      z.object({
        values: z
          .array(z.string())
          .min(1)
          .describe(
            "Row cell values in the same order as `columns`. All stringified — '0' for empty counts.",
          ),
        highlight: z
          .enum(["us", "opposition"])
          .optional()
          .describe(
            "Tints the row in the PDF: 'us' = club green, 'opposition' = CTA orange. Omit otherwise.",
          ),
      }),
    )
    .min(1),
});

export type ScoutLeagueTable = z.infer<typeof scoutLeagueTableSchema>;

export const scoutReportContentSchema = z.object({
  intro: z
    .string()
    .min(20)
    .max(800)
    .describe(
      "1–2 paragraphs covering scope: which match, format, opposition, why it matters. Appears on the overview (first) page.",
    ),
  weather: z
    .object({
      summary: z
        .string()
        .min(5)
        .describe(
          "Plain-English forecast summary (temp, wind, rain probability, conditions).",
        ),
      retrievedAt: z
        .string()
        .min(1)
        .describe(
          "When the forecast was retrieved, e.g. '2026-05-04 09:23 BST'. Cite freshness.",
        ),
      source: z
        .string()
        .optional()
        .describe("Source label, e.g. 'Open-Meteo'."),
    })
    .optional(),
  leagueTable: scoutLeagueTableSchema
    .optional()
    .describe(
      "Structured division standings rendered on page 1 of the PDF. Populate from a pc_league_table response when the fixture is a league match. Omit for cup / friendly matches.",
    ),
  ourPlayers: z
    .array(playerSchema)
    .max(15)
    .optional()
    .describe(
      "Selected XI / squad — names from match selection, stats from our DB.",
    ),
  ourPlayersCharts: z
    .array(reportChartSchema)
    .max(4)
    .optional()
    .describe(
      "Charts in the 'Our Players' section, e.g. season averages, recent form. Each entry references a chartId returned by the chart_render tool.",
    ),
  theirPlayers: z
    .array(playerSchema)
    .max(15)
    .optional()
    .describe(
      "Opposition key players, sourced from Play Cricket recent matches.",
    ),
  theirPlayersCharts: z.array(reportChartSchema).max(4).optional(),
  tossDecision: z
    .string()
    .min(10)
    .max(800)
    .describe(
      "1–3 sentences on the toss call: bat/bowl preference and why (weather, pitch, opposition strengths). Markdown bold/italic allowed.",
    ),
  overallStrategy: z
    .string()
    .min(10)
    .max(800)
    .describe(
      "1–3 sentences on the headline plan: what we're trying to do across the day. Markdown bold/italic allowed.",
    ),
  keyMatchups: z
    .string()
    .min(10)
    .describe(
      "Match-up plans (our bowlers vs their threats, our batters vs their key bowlers). Gets its own page between Their Players and Tactics. Markdown bold/italic allowed; use blank lines for paragraph breaks.",
    ),
  tactics: z
    .string()
    .min(20)
    .describe(
      "Detailed batting/bowling order, fielding plans, phase-by-phase plans. Toss decision and overall strategy live in their own fields — keep them out of here. Gets its own page. Markdown bold/italic allowed.",
    ),
  conclusion: z
    .string()
    .min(10)
    .describe(
      "Short, encouraging close. Renderer appends 'Up The Main' — do not include it yourself.",
    ),
  references: z
    .array(referenceSchema)
    .max(40)
    .describe(
      "Filled by the runReport pipeline from cite_* tool invocations during the run. Emit an empty array — server-side overrides whatever you put here.",
    ),
});

export const scoutReportPayloadSchema = scoutReportContentSchema.extend({
  match: z
    .string()
    .min(3)
    .max(160)
    .describe(
      "Match line for the PDF cover, e.g. 'Percy Main 1st XI v Tynemouth 1st XI'. No 'Scouting Report' prefix, no date — those are placed by the renderer.",
    ),
  matchDate: z
    .string()
    .min(3)
    .max(40)
    .describe(
      "Display-formatted match date for the PDF cover, e.g. '10 May 2026'. Already formatted — the renderer prints it verbatim under the match line.",
    ),
});

export type ScoutReportContent = z.infer<typeof scoutReportContentSchema>;
export type ScoutReportPayload = z.infer<typeof scoutReportPayloadSchema>;
export type ScoutReportPlayer = z.infer<typeof playerSchema>;
export type ScoutReportChart = z.infer<typeof reportChartSchema>;
export type ScoutReportReference = z.infer<typeof referenceSchema>;

/**
 * Single source of truth for the report's display title — used as the thread
 * title, the data-report card label, the scout_report.title DB column, and
 * the PDF Document metadata. Always derived from match + matchDate so the
 * model can't fabricate a third variant that drifts.
 */
export function scoutReportDisplayTitle(payload: {
  match: string;
  matchDate: string;
}): string {
  return `Scouting Report: ${payload.match} — ${payload.matchDate}`;
}

// ── data-report card payload ───────────────────────────────────────────────
//
// Shape of the data-report UI message part written by the generate_report
// tool and consumed by the FE ReportCard. The card polls /scout/reports/:id
// for live state — `status` and `startedAt` drive the loading UI; the rest
// is fixed at insert time.

export interface ReportData {
  reportId: string;
  title: string;
  fileSizeBytes: number | null;
  createdAt: string;
  status: "queued" | "generating" | "ready" | "failed";
  errorMessage?: string;
  /** Date.now() at execute() top — used for the elapsed-time counter on the
   *  loading card. */
  startedAt?: number;
}
