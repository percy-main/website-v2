import { chartSpecSchema, type ChartSpec } from "@percy-main/shared";
import { tool, type UIMessageStreamWriter } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface ChartToolDeps {
  // The route wraps streamText in a createUIMessageStream; that gives us a
  // writer the chart tool can use to emit a data-chart part inline with the
  // assistant's prose. Tools called inside streamText don't get a writer by
  // default — we close over it here.
  writer: UIMessageStreamWriter;
}

// Anthropic's API requires each tool's input_schema to be an OBJECT schema at
// the top level. Wrap the spec in an object so JSON-schema generation emits
// { type: "object", properties: { chart: {...} } }.
const chartInputSchema = z.object({
  chart: chartSpecSchema,
});

export function createChartTool(deps: ChartToolDeps) {
  const { writer } = deps;

  return {
    chart_render: tool({
      description: `Render a Chart.js v4 chart inline in the chat. The frontend uses react-chartjs-2 and passes your spec straight through to Chart.js — so any valid Chart.js v4 configuration works (bar / line / scatter / bubble / pie / doughnut / radar / polarArea, with any combination of options.scales, options.plugins, indexAxis, stacked, dual axes, custom colours, etc.).

When to render:
- Trend over time (a player's batting average across innings, our average score by month) → type: "line"
- Categorical comparison (dismissals by mode, runs by opposition, points by division) → type: "bar"
- Correlation between two numeric variables (innings score vs air temperature) → type: "scatter", and put a per-point label so users can identify outliers
- Composition / share-of-whole → type: "pie" or "doughnut" (only when categories sum to a meaningful total)
- Multiple comparable metrics for a few entities → type: "radar"

Don't chart 3 data points; don't chart what reads better as one number. After rendering, still summarise the headline finding in your prose — the chart supplements your analysis.

Hard rules:
- Spec must be wrapped in { "chart": {...} }.
- The "data" object MUST have a "datasets" array. Each dataset MUST have a "data" array. "labels" is optional but typical for bar/line/pie.
- No JavaScript functions or callbacks anywhere — the spec is JSON-serialised. options.plugins.tooltip.callbacks etc. won't work; omit them.
- Total points across all datasets must be ≤ 1000.
- "caption" is a Scout-specific extra (rendered below the chart for sample-size / source notes); it is not a Chart.js field.

EXAMPLE — vertical bar (categorical):
{
  "chart": {
    "type": "bar",
    "data": {
      "labels": ["Bowled", "LBW", "Caught", "Run out", "Stumped"],
      "datasets": [{
        "label": "Dismissals",
        "data": [12, 5, 18, 3, 1],
        "backgroundColor": "rgba(31, 119, 180, 0.7)",
        "borderColor": "rgba(31, 119, 180, 1)",
        "borderWidth": 1
      }]
    },
    "options": {
      "plugins": {
        "title": { "display": true, "text": "Percy Main 2025 — Dismissals by mode" },
        "legend": { "display": false }
      },
      "scales": { "y": { "beginAtZero": true, "title": { "display": true, "text": "Innings" } } }
    },
    "caption": "Across 47 innings."
  }
}

EXAMPLE — horizontal bar (use indexAxis: "y" — Chart.js's built-in flip):
{
  "chart": {
    "type": "bar",
    "data": {
      "labels": ["Blyth Duncan Jnr", "Patrick Rathbone", "Andrew Beer"],
      "datasets": [{
        "label": "Games played",
        "data": [520, 381, 316],
        "backgroundColor": "rgba(0, 102, 204, 0.75)"
      }]
    },
    "options": {
      "indexAxis": "y",
      "plugins": {
        "title": { "display": true, "text": "Percy Main CC — Most appearances (all time)" },
        "legend": { "display": false }
      },
      "scales": { "x": { "beginAtZero": true, "title": { "display": true, "text": "Games" } } }
    }
  }
}

EXAMPLE — multi-series line (one dataset per series):
{
  "chart": {
    "type": "line",
    "data": {
      "labels": ["May", "Jun", "Jul", "Aug", "Sep"],
      "datasets": [
        { "label": "1st XI", "data": [142, 168, 155, 189, 174], "borderColor": "#1f77b4", "fill": false, "tension": 0.2 },
        { "label": "2nd XI", "data": [128, 134, 161, 147, 158], "borderColor": "#ff7f0e", "fill": false, "tension": 0.2 }
      ]
    },
    "options": {
      "plugins": { "title": { "display": true, "text": "Average score by month, 2025" } },
      "scales": { "y": { "title": { "display": true, "text": "Runs" } } }
    }
  }
}

EXAMPLE — scatter with labelled points (each datum is {x, y}; the dataset.label shows in the legend):
{
  "chart": {
    "type": "scatter",
    "data": {
      "datasets": [{
        "label": "Innings score vs air temperature",
        "data": [
          { "x": 14, "y": 87 },
          { "x": 18, "y": 142 },
          { "x": 22, "y": 168 }
        ],
        "backgroundColor": "rgba(44, 160, 44, 0.7)"
      }]
    },
    "options": {
      "scales": {
        "x": { "title": { "display": true, "text": "Air temp (°C)" } },
        "y": { "title": { "display": true, "text": "Innings score" } }
      }
    }
  }
}`,
      inputSchema: chartInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; this tool has no async work to do.
      execute: async ({ chart }: { chart: ChartSpec }) => {
        const id = randomUUID();
        writer.write({
          type: "data-chart",
          id,
          data: chart,
        });
        // Short tool result the model sees — actual chart payload is already
        // streaming to the client via the data part above.
        const points = chart.data.datasets.reduce(
          (n, ds) => n + ds.data.length,
          0,
        );
        return {
          rendered: true,
          chartId: id,
          type: chart.type,
          datasets: chart.data.datasets.length,
          points,
        };
      },
    }),
  };
}

export type ChartTools = ReturnType<typeof createChartTool>;
