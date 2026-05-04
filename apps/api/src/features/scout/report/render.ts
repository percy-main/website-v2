import type { ScoutReportPayload } from "@percy-main/shared";
import { renderToBuffer } from "@react-pdf/renderer";
import { format } from "date-fns";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderChartPng } from "./chart-png.ts";
import { ScoutReportPdf } from "./pdf-document.tsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "..", "..", "assets");
const CLUB_LOGO_PATH = join(ASSETS, "club_logo.png");

// Cache the logo. It's <100KB and changes only when the asset changes,
// so a one-shot read at module load is fine.
const logoPng = readFileSync(CLUB_LOGO_PATH);

/**
 * Render a structured Scout report payload to a PDF Buffer.
 *
 * Charts are rasterised to PNG via @napi-rs/canvas + chart.js, then
 * embedded as <Image> in the @react-pdf/renderer document. Synchronous
 * end-to-end aside from the final renderToBuffer call.
 */
export async function renderScoutReportPdf(
  payload: ScoutReportPayload,
): Promise<Buffer> {
  const ourCharts = (payload.ourPlayersCharts ?? []).map((c, i) => ({
    id: String(i),
    png: renderChartPng(c.spec),
  }));
  const theirCharts = (payload.theirPlayersCharts ?? []).map((c, i) => ({
    id: String(i),
    png: renderChartPng(c.spec),
  }));

  const generatedAt = format(new Date(), "d MMM yyyy, HH:mm");

  const doc = React.createElement(ScoutReportPdf, {
    payload,
    ourCharts,
    theirCharts,
    logoPng,
    generatedAt,
  });

  // ScoutReportPdf returns a <Document>, but TS sees only the function
  // component's typed return, which doesn't structurally match
  // ReactElement<DocumentProps>. Cast the input at the boundary, then
  // assert the runtime shape on the way out — @react-pdf's published
  // types vary by version (Buffer vs ReadableStream) and a silent type
  // mismatch would corrupt the S3 upload (zero-length writes, undefined
  // .length on the Buffer).
  const out = await renderToBuffer(
    doc as unknown as Parameters<typeof renderToBuffer>[0],
  );
  if (!Buffer.isBuffer(out)) {
    throw new Error(
      `renderToBuffer returned a non-Buffer (${typeof out}); expected a Node Buffer. Check the installed @react-pdf/renderer version.`,
    );
  }
  return out;
}
