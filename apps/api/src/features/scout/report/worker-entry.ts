// Worker thread entry — receives a ScoutReportPayload from the main thread,
// rasterises charts (synchronous @napi-rs/canvas + chart.js), runs the
// @react-pdf/renderer layout, and posts the resulting PDF buffer back.
//
// All the CPU-heavy synchronous work lives here so the main Fastify event loop
// is never blocked. One PDF render previously locked the API server for
// 10–30s; with this offloaded, the main thread stays responsive throughout.

import type { ScoutReportPayload } from "@percy-main/shared";
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

interface RenderRequest {
  id: number;
  payload: ScoutReportPayload;
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

parentPort.on("message", async (msg: RenderRequest) => {
  try {
    const ourCharts = (msg.payload.ourPlayersCharts ?? []).map((c, i) => ({
      id: String(i),
      png: renderChartPng(c.spec),
    }));
    const theirCharts = (msg.payload.theirPlayersCharts ?? []).map((c, i) => ({
      id: String(i),
      png: renderChartPng(c.spec),
    }));

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
    parentPort!.postMessage(reply, [pdf.buffer as ArrayBuffer]);
  } catch (err) {
    const reply: RenderFailure = {
      id: msg.id,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    parentPort!.postMessage(reply);
  }
});
