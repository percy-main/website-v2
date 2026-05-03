import { z } from "zod";

// Chart.js v4 spec, deliberately permissive. We tried a strict
// discriminated-union schema {type, data: [{x,y}], title, ...} originally.
// It looked tidy but the model kept producing Chart.js-shaped specs anyway
// — Chart.js has overwhelming representation in training data and the model
// reaches for it on autopilot, even with a custom schema described in the
// tool's input_schema.
//
// Switched to letting the model emit native Chart.js v4 specs and validating
// only the outer envelope. The renderer (apps/web/src/pages/scout/scout-chart.tsx)
// passes data + options straight to react-chartjs-2 and trusts Chart.js to
// ignore unknown options. This:
//   - removes the model's incentive to invent the spec from scratch
//   - unlocks the full Chart.js surface (horizontal bar via indexAxis,
//     stacked datasets, dual axes, custom colours, log scales, …) without
//     mirroring it in our schema
//
// Trade-off: we accept any object shape under data/options, so a malformed
// or pathological spec from the model would crash react-chartjs-2 at render
// time rather than be caught by Zod up-front. The maxDataPoints check below
// is the defence-in-depth cap.

const SUPPORTED_TYPES = [
  "bar",
  "line",
  "scatter",
  "bubble",
  "pie",
  "doughnut",
  "radar",
  "polarArea",
] as const;

const MAX_DATA_POINTS = 1000;

// Chart.js's data is always { labels?: [...], datasets: [{label?, data: [...], ...}, ...] }.
// We accept any object shape and only deep-check that the total number of
// data points across all datasets stays under MAX_DATA_POINTS — this is a
// soft guard against pathological model output (gigantic arrays) that would
// kill the browser without giving useful feedback.
const chartDataSchema = z
  .looseObject({
    labels: z.array(z.unknown()).optional(),
    datasets: z
      .array(
        z.looseObject({
          label: z.string().optional(),
          data: z.array(z.unknown()),
        }),
      )
      .min(1),
  })
  .refine(
    (d) =>
      d.datasets.reduce((n, ds) => n + ds.data.length, 0) <= MAX_DATA_POINTS,
    {
      message: `Total data points across datasets must be ≤ ${MAX_DATA_POINTS}.`,
    },
  );

export const chartSpecSchema = z.object({
  type: z.enum(SUPPORTED_TYPES),
  data: chartDataSchema,
  // Chart.js options is a deeply nested grab-bag (scales, plugins, animations,
  // interaction, …). Pass through as-is; the renderer just hands it to
  // react-chartjs-2.
  options: z.record(z.string(), z.unknown()).optional(),
  // Optional Scout-specific extras — rendered as caption / surrounding chrome.
  // Not part of Chart.js itself; we strip them before handing data to the
  // renderer.
  caption: z
    .string()
    .optional()
    .describe(
      "Optional one-line caption rendered below the chart (sample size, source, etc.).",
    ),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type ChartType = (typeof SUPPORTED_TYPES)[number];
