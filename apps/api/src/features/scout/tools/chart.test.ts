import { chartSpecSchema } from "@percy-main/shared";
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

describe("chart_render — Chart.js envelope", () => {
  it("emits a data-chart part for a Chart.js bar spec", async () => {
    const { result, writer } = await runChart({
      type: "bar",
      data: {
        labels: ["May", "Jun"],
        datasets: [{ label: "Avg score", data: [142, 168] }],
      },
      options: {
        plugins: { title: { display: true, text: "Avg score by month" } },
      },
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
      datasets: 1,
      points: 2,
    });
  });

  it("accepts horizontal bar (indexAxis: 'y') without re-shaping the spec", async () => {
    const { result } = await runChart({
      type: "bar",
      data: {
        labels: ["A", "B", "C"],
        datasets: [{ data: [1, 2, 3] }],
      },
      options: { indexAxis: "y" },
    });
    expect(result).toMatchObject({ type: "bar", datasets: 1, points: 3 });
  });

  it("supports multi-dataset line charts and counts total points across datasets", async () => {
    const { result } = await runChart({
      type: "line",
      data: {
        labels: ["May", "Jun", "Jul"],
        datasets: [
          { label: "1st XI", data: [100, 120, 140] },
          { label: "2nd XI", data: [80, 90, 110] },
        ],
      },
    });
    expect(result).toMatchObject({ type: "line", datasets: 2, points: 6 });
  });

  it("accepts scatter datasets with {x, y} points", async () => {
    const { result, writer } = await runChart({
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Score vs temp",
            data: [
              { x: 14, y: 87 },
              { x: 18, y: 142 },
            ],
          },
        ],
      },
    });
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      data: { type: string; data: { datasets: Array<{ data: unknown[] }> } };
    };
    expect(part.data.type).toBe("scatter");
    expect(part.data.data.datasets[0].data).toHaveLength(2);
    expect(result).toMatchObject({ type: "scatter", points: 2 });
  });

  it("accepts pie / doughnut / radar / polarArea / bubble", async () => {
    for (const type of [
      "pie",
      "doughnut",
      "radar",
      "polarArea",
      "bubble",
    ] as const) {
      const { result } = await runChart({
        type,
        data: { datasets: [{ data: [1, 2, 3] }] },
      });
      expect(result).toMatchObject({ type });
    }
  });

  it("passes through caption alongside the Chart.js spec", async () => {
    const { writer } = await runChart({
      type: "bar",
      data: { datasets: [{ data: [1, 2] }] },
      caption: "n = 22 innings",
    });
    const part = (writer.write.mock.calls[0] as unknown[])[0] as {
      data: { caption?: string };
    };
    expect(part.data.caption).toBe("n = 22 innings");
  });
});

// Validation rules tested directly against the Zod schema. These belong here
// rather than as part of the tool execute, since the AI SDK validates
// inputSchema before calling execute() — a unit test that calls execute()
// directly bypasses that and accepts anything.
describe("chartSpecSchema — input validation", () => {
  it("rejects an unknown chart type", () => {
    const result = chartSpecSchema.safeParse({
      type: "treemap",
      data: { datasets: [{ data: [1] }] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a spec with no datasets", () => {
    const result = chartSpecSchema.safeParse({
      type: "bar",
      data: { labels: ["A"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a spec exceeding the 1000-point cap", () => {
    const huge = Array.from({ length: 1001 }, (_, i) => i);
    const result = chartSpecSchema.safeParse({
      type: "bar",
      data: { datasets: [{ data: huge }] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a spec at exactly the cap", () => {
    const justUnder = Array.from({ length: 1000 }, (_, i) => i);
    const result = chartSpecSchema.safeParse({
      type: "bar",
      data: { datasets: [{ data: justUnder }] },
    });
    expect(result.success).toBe(true);
  });
});
