import { z } from "zod";
import { chartSpecSchema } from "./scout-chart.ts";

// Two related schemas:
//
// - scoutReportContentSchema: what the researcher sub-agent produces. Section
//   content only — the bits that need data gathering + synthesis.
// - scoutReportPayloadSchema: what the renderer consumes. Content plus the
//   match identifiers (which come from the generate_report tool input, not
//   the model — they're known up front).
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

const reportChartSchema = z.object({
  caption: z
    .string()
    .min(1)
    .describe("One-line caption explaining what the chart shows."),
  spec: chartSpecSchema,
});

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
      "Charts in the 'Our Players' section, e.g. season averages, recent form.",
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
      "1–3 sentences on the toss call: bat/bowl preference and why (weather, pitch, opposition strengths). Appears on the overview (first) page. Markdown bold/italic allowed.",
    ),
  overallStrategy: z
    .string()
    .min(10)
    .max(800)
    .describe(
      "1–3 sentences on the headline plan: what we're trying to do across the day. Appears on the overview (first) page. Markdown bold/italic allowed.",
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
      "Every URL fetched while building the report (scorecards, weather, stats). Required.",
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
// tool and consumed by the FE ReportCard. Single id-keyed part is replaced
// repeatedly during generation as phases advance — the FE renders whatever
// the latest snapshot says.

export type ReportPhaseName = "researcher" | "analyst" | "render";

export interface ReportPhaseState {
  state: "pending" | "active" | "done" | "failed";
  /** Date.now() when state moved to "active". */
  startedAt?: number;
  /** Date.now() when state moved to "done" or "failed". */
  endedAt?: number;
  /** Optional small summary for the done state. */
  summary?: {
    records?: number;
    claims?: number;
    bytes?: number;
  };
}

export interface ReportToolCallEvent {
  /** Stable key for React reconciliation — e.g. `${phase}-${step}-${idx}`. */
  id: string;
  phase: ReportPhaseName;
  toolName: string;
  /** Date.now() when the tool call was observed. */
  at: number;
}

// Per-phase wall-clock budgets — used as the BE's hard timeouts AND the FE's
// active-phase countdowns. Single source of truth so the FE can never show
// "over budget" red while the BE is still well within its timeout.
//
// - researcher: 30+ small steps on flash, 3-9s/step. Comprehensive scouts
//   regularly take 8-15 minutes when the model walks several seasons of
//   opposition matches. 12 minutes is the practical ceiling that cuts off
//   genuinely-stuck steps without timing out useful long runs.
// - analyst: one generateText call carrying the whole evidence packet
//   inline. Rich packets (50+ records) can run 10+ minutes even on flash;
//   20 minutes for headroom.
// - render: chart rasterisation + react-pdf layout in the worker. 10-30s
//   typical; 30s gives a safe ceiling.
export const REPORT_PHASE_BUDGETS_MS: Record<
  "researcher" | "analyst" | "render",
  number
> = {
  researcher: 720_000,
  analyst: 1_200_000,
  render: 30_000,
};

export interface ReportData {
  reportId: string;
  title: string;
  fileSizeBytes: number | null;
  createdAt: string;
  status: "generating" | "ready" | "failed";
  errorMessage?: string;
  /** Date.now() at execute() top — used for global elapsed display. */
  startedAt?: number;
  /** Per-phase state. Only present while status === "generating" or after
   *  completion (so the FE can render the "took Xm Ys" breakdown). */
  phases?: Record<ReportPhaseName, ReportPhaseState>;
  /** Recent tool calls during the active phase, capped server-side to the
   *  last ~6. The FE renders each as a fly-out chip and lets old ones fade. */
  recentToolCalls?: ReportToolCallEvent[];
}
