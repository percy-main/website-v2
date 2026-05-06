// Worker thread entry — receives a ScoutReportPayload + chart-spec map from
// the main thread, rasterises each referenced chart (synchronous
// @napi-rs/canvas + chart.js), runs the @react-pdf/renderer layout, and posts
// the resulting PDF buffer back.
//
// All the CPU-heavy synchronous work lives here so the main Fastify event loop
// is never blocked. One PDF render previously locked the API server for
// 10–30s; with this offloaded, the main thread stays responsive throughout.

import type { ChartSpec, ScoutReportPayload } from "@percy-main/shared";
import { renderToBuffer } from "@react-pdf/renderer";
import { parentPort } from "node:worker_threads";
import React from "react";
import { renderChartPng } from "./chart-png.ts";
import { ScoutReportPdf } from "./pdf-document.tsx";

if (!parentPort) {
  // Worker bootstrap invariant — if this throws, the worker exits and the
  // main-thread queue rejects every pending job. Better than silently doing
  // nothing.
  throw new Error("worker-entry must be loaded as a worker thread");
}

// Capture the narrowed reference so the closures below don't need non-null
// assertions on every postMessage call.
const port = parentPort;

interface RenderRequest {
  id: number;
  payload: ScoutReportPayload;
  /** chartId → Chart.js spec. Each chart referenced from payload's
   *  ourPlayersCharts / theirPlayersCharts must have a spec here. */
  chartSpecs: Record<string, ChartSpec>;
  generatedAt: string;
  // Logo arrives as a Uint8Array (structured-cloned). We rebuild a Node
  // Buffer in the worker because @react-pdf/renderer expects Buffer for
  // <Image src={buffer} /> rather than a bare Uint8Array.
  logoPng: Uint8Array;
}

interface RenderSuccess {
  id: number;
  ok: true;
  pdf: Uint8Array;
}

interface RenderFailure {
  id: number;
  ok: false;
  message: string;
  stack?: string;
}

/**
 * Resolve a list of {caption, chartId} entries to the rasterised PNG list
 * the PDF doc expects ({id, png} where id matches the chartId). Charts whose
 * id has no matching spec are dropped — the agent shouldn't reference an
 * unrendered id, but if it slips through we'd rather emit a slightly thinner
 * PDF than throw mid-render.
 */
function rasterise(
  charts: Array<{ caption: string; chartId: string }> | undefined,
  specs: Record<string, ChartSpec>,
): Array<{ id: string; png: Buffer }> {
  if (!charts) return [];
  const out: Array<{ id: string; png: Buffer }> = [];
  for (const c of charts) {
    const spec = specs[c.chartId];
    if (!spec) continue;
    out.push({ id: c.chartId, png: renderChartPng(spec) });
  }
  return out;
}

async function handleRenderRequest(msg: RenderRequest): Promise<void> {
  try {
    const ourCharts = rasterise(msg.payload.ourPlayersCharts, msg.chartSpecs);
    const theirCharts = rasterise(
      msg.payload.theirPlayersCharts,
      msg.chartSpecs,
    );

    const doc = React.createElement(ScoutReportPdf, {
      payload: msg.payload,
      ourCharts,
      theirCharts,
      logoPng: Buffer.from(msg.logoPng),
      generatedAt: msg.generatedAt,
    });

    // ScoutReportPdf returns a <Document>, but TS only sees the function
    // component's return type. Cast at the boundary; assert at runtime so a
    // silent type drift in @react-pdf/renderer's published types doesn't ship
    // an undefined .length to the S3 upload caller.
    const pdf = await renderToBuffer(
      doc as unknown as Parameters<typeof renderToBuffer>[0],
    );
    if (!Buffer.isBuffer(pdf)) {
      throw new Error(
        `renderToBuffer returned a non-Buffer (${typeof pdf}); check the installed @react-pdf/renderer version.`,
      );
    }

    const reply: RenderSuccess = { id: msg.id, ok: true, pdf };
    // Transfer the underlying ArrayBuffer rather than copying — the PDF can
    // run to several MB and there's no reason to keep the worker's copy.
    // Node `Buffer.buffer` is always a regular ArrayBuffer (never Shared);
    // the cast satisfies the structured-clone Transferable typing.
    port.postMessage(reply, [pdf.buffer as ArrayBuffer]);
  } catch (err) {
    const reply: RenderFailure = {
      id: msg.id,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    port.postMessage(reply);
  }
}

// Sync wrapper around the async handler — node:worker_threads `.on('message')`
// expects a void-returning listener; passing an async function trips
// no-misused-promises. handleRenderRequest never rejects (it catches into a
// failure reply), so void-discarding the promise is safe.
port.on("message", (msg: RenderRequest) => {
  void handleRenderRequest(msg);
});
