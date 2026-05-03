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
// the top level. A bare z.discriminatedUnion produces { anyOf: [...] }, which
// the API rejects with "tools.N.custom.input_schema.type: Field required".
// Wrap the spec in an object so JSON-schema generation emits
// { type: "object", properties: { chart: {...} } }.
const chartInputSchema = z.object({
  chart: chartSpecSchema,
});

export function createChartTool(deps: ChartToolDeps) {
  const { writer } = deps;

  return {
    chart_render: tool({
      description: `Render a chart inline in the chat. Use when a chart communicates the answer faster than prose or a table — e.g. trend over time, distribution across categories, or a scatter to look for correlation.

Render unsolicited only when the data clearly benefits from it. Don't chart 3 data points; don't chart something better expressed as one number. Common shapes that DO chart well:

- bar: a team's average score by month; dismissals by mode (bowled/lbw/caught/run-out); runs scored against opposition X across seasons.
- line: a player's batting average across innings of a season; team total over the last 10 matches.
- scatter: any "does X correlate with Y" question — runs scored vs air temperature, strike rate vs over of dismissal, etc. Include label per point so the user can see which match/innings each point is.

Always still summarise the chart's headline finding in your prose — the chart supplements your analysis, it doesn't replace it.`,
      inputSchema: chartInputSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- AI SDK execute signature is async; this tool has no async work to do.
      execute: async ({ chart }: { chart: ChartSpec }) => {
        const id = randomUUID();
        writer.write({
          type: "data-chart",
          id,
          data: chart,
        });
        // The tool result the model sees. Keep it short; the chart payload is
        // already on its way to the client via the data part above.
        return {
          rendered: true,
          chartId: id,
          type: chart.type,
          points: chart.data.length,
        };
      },
    }),
  };
}

export type ChartTools = ReturnType<typeof createChartTool>;
