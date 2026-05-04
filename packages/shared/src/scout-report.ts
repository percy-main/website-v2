import { z } from "zod";
import { chartSpecSchema } from "./scout-chart.ts";

// Schema for the structured payload the agent passes to the
// generate_report tool. The renderer turns this into a PDF.
//
// Kept deliberately section-shaped (rather than free-form markdown) so the
// PDF layout is predictable: every report has the same headed sections,
// charts always render where charts go, and references always come last.

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
  url: z.string().url(),
});

const reportChartSchema = z.object({
  caption: z
    .string()
    .min(1)
    .describe("One-line caption explaining what the chart shows."),
  spec: chartSpecSchema,
});

export const scoutReportPayloadSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(160)
    .describe(
      "Report title, e.g. 'Scouting Report: Percy Main 1st XI v Tynemouth, 10 May 2026'.",
    ),
  intro: z
    .string()
    .min(20)
    .max(800)
    .describe(
      "1–2 paragraphs covering scope: which match, format, opposition, why it matters.",
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
  tactics: z
    .string()
    .min(20)
    .describe(
      "Toss call, batting/bowling order, fielding plans, matchup-specific tactics. Markdown allowed.",
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
      "Every URL the agent fetched while building the report (scorecards, weather, stats). Required.",
    ),
});

export type ScoutReportPayload = z.infer<typeof scoutReportPayloadSchema>;
export type ScoutReportPlayer = z.infer<typeof playerSchema>;
export type ScoutReportChart = z.infer<typeof reportChartSchema>;
export type ScoutReportReference = z.infer<typeof referenceSchema>;
