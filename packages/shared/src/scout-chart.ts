import { z } from "zod";

// Chart specs are streamed to the FE as data-chart parts. We keep the surface
// narrow on purpose: bar / line / scatter cover almost every cricket-stats
// chart we'd want, and a tight schema means the model rarely produces
// invalid output. Use a discriminated union (not optional fields) so each
// chart type has exactly the keys it needs.

const xValueSchema = z.union([z.string(), z.number()]);
const yValueSchema = z.number();

const barDatumSchema = z.object({
  x: xValueSchema,
  y: yValueSchema,
});

const lineDatumSchema = z.object({
  x: xValueSchema,
  y: yValueSchema,
  series: z.string().optional(),
});

const scatterDatumSchema = z.object({
  x: z.number(),
  y: z.number(),
  label: z.string().optional(),
  series: z.string().optional(),
});

const baseFieldsSchema = z.object({
  title: z.string().min(1).describe("Title shown above the chart."),
  xLabel: z.string().optional().describe("X-axis label."),
  yLabel: z.string().optional().describe("Y-axis label."),
  caption: z
    .string()
    .optional()
    .describe(
      "Optional one-line caption shown below the chart (sample size, source, etc.).",
    ),
});

export const chartSpecSchema = z.discriminatedUnion("type", [
  baseFieldsSchema.extend({
    type: z.literal("bar"),
    data: z
      .array(barDatumSchema)
      .min(1)
      .max(200)
      .describe("Each datum is one bar: { x, y }."),
  }),
  baseFieldsSchema.extend({
    type: z.literal("line"),
    data: z
      .array(lineDatumSchema)
      .min(2)
      .max(500)
      .describe(
        "Points along one or more lines: { x, y, series? }. If `series` is set on any datum, points are grouped into separate lines.",
      ),
  }),
  baseFieldsSchema.extend({
    type: z.literal("scatter"),
    data: z
      .array(scatterDatumSchema)
      .min(1)
      .max(500)
      .describe(
        "Points: { x, y, label?, series? }. Both x and y must be numeric. Use scatter when looking for correlation (e.g. innings score vs air temperature).",
      ),
  }),
]);

export type ChartSpec = z.infer<typeof chartSpecSchema>;
