import type { ChartSpec } from "@percy-main/shared";
import { lazy, Suspense } from "react";

// Lazy-load the chart renderer so users who never trigger a chart don't pay
// the chart.js bundle cost (~70KB gzipped + react-chartjs-2). The render
// envelope (figure/caption) is local so the empty state has no visible flash.
const ChartBody = lazy(() =>
  import("./scout-chart-body.tsx").then((m) => ({ default: m.ChartBody })),
);

const HEIGHT = 280;

export function ScoutChart({ spec }: { spec: ChartSpec }) {
  // The model sometimes sets a title via options.plugins.title.text; we let
  // Chart.js render that one. Caption is our Scout-specific extra below.
  return (
    <figure className="my-3 rounded border border-stone-200 bg-white p-3">
      <div style={{ width: "100%", height: HEIGHT }}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-stone-400">
              Rendering chart…
            </div>
          }
        >
          <ChartBody spec={spec} />
        </Suspense>
      </div>
      {spec.caption ? (
        <figcaption className="mt-2 text-xs text-stone-500">
          {spec.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
