import type { UIMessageStreamWriter } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createChartTool } from "./chart.ts";

const opts = {
  toolCallId: "test-call",
  messages: [],
  abortSignal: undefined,
} as unknown as Parameters<
  NonNullable<ReturnType<typeof createChartTool>["chart_render"]["execute"]>
>[1];

function makeWriter() {
  return {
    write: vi.fn(),
    merge: vi.fn(),
    onError: undefined,
  } as unknown as UIMessageStreamWriter & { write: ReturnType<typeof vi.fn> };
}

async function runChart(spec: unknown) {
  const writer = makeWriter();
  const { chart_render } = createChartTool({ writer });
  const exec = chart_render.execute;
  if (!exec) throw new Error("no execute");
  const result = await exec({ chart: spec } as never, opts as never);
  return { result, writer };
}

describe("chart_render", () => {
  it("emits a data-chart part via the writer for a bar chart", async () => {
    const { result, writer } = await runChart({
      type: "bar",
      title: "Average score by month",
      data: [
        { x: "May", y: 145 },
        { x: "Jun", y: 162 },
      ],
    });

    expect(writer.write).toHaveBeenCalledTimes(1);
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      type: string;
      id: string;
      data: { type: string };
    };
    expect(part.type).toBe("data-chart");
    expect(part.data.type).toBe("bar");
    expect(typeof part.id).toBe("string");
    expect(result).toMatchObject({
      rendered: true,
      type: "bar",
      points: 2,
    });
  });

  it("emits a scatter chart with labelled points", async () => {
    const { writer } = await runChart({
      type: "scatter",
      title: "Innings score vs air temp",
      xLabel: "Air temperature (°C)",
      yLabel: "Runs",
      data: [
        { x: 14, y: 87, label: "vs Tynemouth, 13/05" },
        { x: 22, y: 168, label: "vs Backworth, 03/06" },
      ],
    });
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      data: { type: string; data: unknown[] };
    };
    expect(part.data.type).toBe("scatter");
    expect(part.data.data).toHaveLength(2);
  });
});
