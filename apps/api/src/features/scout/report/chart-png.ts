import { createCanvas } from "@napi-rs/canvas";
import type { ChartSpec } from "@percy-main/shared";
import { Chart, registerables } from "chart.js";

// Register all controllers / scales / elements once at module load.
// Chart.js v4 doesn't auto-register; without this every chart type would
// throw "is not a registered controller" at first render.
let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  Chart.register(...registerables);
  registered = true;
}

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 360;

/**
 * Render a Chart.js v4 spec to a PNG buffer, suitable for embedding in a
 * @react-pdf/renderer <Image> tag.
 *
 * Animation and responsiveness are forcibly disabled — both depend on the
 * browser event loop and produce a blank canvas in Node otherwise.
 */
export function renderChartPng(
  spec: ChartSpec,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
): Buffer {
  ensureRegistered();

  const canvas = createCanvas(width, height);

  const chart = new Chart(canvas as unknown as HTMLCanvasElement, {
    type: spec.type,
    data: spec.data as Chart["data"],
    options: {
      ...(spec.options ?? {}),
      animation: false,
      responsive: false,
      // Some charts will otherwise stretch beyond the canvas.
      maintainAspectRatio: false,
      devicePixelRatio: 2,
    },
  });

  // try/finally so a malformed spec or a toBuffer crash still tears down
  // the Chart instance — Chart.js holds it in a global registry until
  // destroy() runs, leaking canvas refs across requests otherwise.
  try {
    // Chart.js draws on construction with animation:false, but call render()
    // to be safe — it's a no-op when nothing has changed.
    chart.render();
    return canvas.toBuffer("image/png");
  } finally {
    chart.destroy();
  }
}
