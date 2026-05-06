import type { ChartSpec, ScoutReportPayload } from "@percy-main/shared";
import { format } from "date-fns";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, type WorkerOptions } from "node:worker_threads";

// Charts referenced from payload.ourPlayersCharts / theirPlayersCharts by
// chartId. Specs come from the report agent's chart_render tool calls and
// are passed to the worker for rasterisation. Plain object so the chartSpecs
// map serialises cleanly across the structured-clone boundary.
export type ChartSpecsByChartId = Record<string, ChartSpec>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "..", "..", "assets");
const CLUB_LOGO_PATH = join(ASSETS, "club_logo.png");

// Logo is read once at module load — it's <100KB, changes only when the asset
// changes, and runs during process boot rather than per-request. Same as the
// pre-worker implementation.
const logoPng = readFileSync(CLUB_LOGO_PATH);

// Resolve the worker entry as a sibling of this file.
//
// Dev (`tsx watch`): import.meta.url ends in .ts. We point the Worker at
// `worker-bootstrap.mjs` — a plain ESM file that programmatically registers
// tsx's loader via `tsx/esm/api`, then dynamic-imports `worker-entry.ts`.
// `--import tsx/esm` in execArgv would NOT work here: tsx's auto-register
// gates on isMainThread, so its hooks never install in a worker.
//
// Prod (`node dist/...`): import.meta.url ends in .js. tsc compiled both
// render.ts and worker-entry.tsx into sibling .js files in dist; tsx isn't
// involved at all. Worker loads worker-entry.js directly.
const isDev = import.meta.url.endsWith(".ts");
const workerUrl = new URL(
  isDev ? "./worker-bootstrap.mjs" : "./worker-entry.js",
  import.meta.url,
);
const workerOptions: WorkerOptions = {};

interface PendingJob {
  id: number;
  payload: ScoutReportPayload;
  chartSpecs: ChartSpecsByChartId;
  generatedAt: string;
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
}

interface WorkerSuccess {
  id: number;
  ok: true;
  pdf: Uint8Array;
}

interface WorkerFailure {
  id: number;
  ok: false;
  message: string;
  stack?: string;
}

type WorkerReply = WorkerSuccess | WorkerFailure;

// Single long-lived worker with a serialised in-process queue.
//
// Why one worker rather than a pool: each worker holds chart.js +
// @napi-rs/canvas + @react-pdf/renderer in memory (~150 MB resident). On a
// free-tier ECS Fargate task, two of those is most of the budget. PDF
// generation is rare (one per scouting session), and each render takes
// 10–30 s — running them in parallel just means doubling memory for no real
// throughput gain at our traffic level. If we ever need concurrency we can
// expand the queue into a pool here.
//
// Why lazy-init: we don't want to pay the worker boot + module-load cost
// (~500 ms–1 s) for every API process that never generates a PDF.
let worker: Worker | null = null;
let busy = false;
let nextId = 1;
const queue: PendingJob[] = [];
const inFlight = new Map<number, PendingJob>();

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(workerUrl, workerOptions);

  worker.on("message", (msg: WorkerReply) => {
    const job = inFlight.get(msg.id);
    if (!job) return;
    inFlight.delete(msg.id);
    busy = false;
    if (msg.ok) {
      // The PDF arrives as a transferred Uint8Array. Wrap as Node Buffer so
      // existing callers (S3 upload, .length, etc.) keep working unchanged.
      job.resolve(
        Buffer.from(msg.pdf.buffer, msg.pdf.byteOffset, msg.pdf.byteLength),
      );
    } else {
      const err = new Error(msg.message);
      if (msg.stack) err.stack = msg.stack;
      job.reject(err);
    }
    pump();
  });

  worker.on("error", (raw: unknown) => {
    // A worker `error` event means an uncaught throw inside the worker —
    // anything in flight is dead. Reject every pending job, drop the worker;
    // ensureWorker() will spin up a fresh one on the next call.
    const err = raw instanceof Error ? raw : new Error(String(raw));
    for (const job of inFlight.values()) job.reject(err);
    inFlight.clear();
    queue.splice(0, queue.length).forEach((j) => j.reject(err));
    busy = false;
    void worker?.terminate();
    worker = null;
  });

  worker.on("exit", (code) => {
    // Unexpected exit (the worker itself returns; we never call .terminate
    // during normal flow). Match the error-handler cleanup so the next
    // render request gets a fresh worker.
    if (code !== 0) {
      const err = new Error(`PDF worker exited unexpectedly with code ${code}`);
      for (const job of inFlight.values()) job.reject(err);
      inFlight.clear();
      queue.splice(0, queue.length).forEach((j) => j.reject(err));
    }
    busy = false;
    worker = null;
  });

  return worker;
}

function pump(): void {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  inFlight.set(next.id, next);
  // Send a fresh Uint8Array view over the cached logo Buffer. We do NOT
  // transfer the underlying ArrayBuffer because we want the cached logo to
  // survive — copies are fine for a 50 KB asset that gets reused on every
  // render.
  ensureWorker().postMessage({
    id: next.id,
    payload: next.payload,
    chartSpecs: next.chartSpecs,
    generatedAt: next.generatedAt,
    logoPng: new Uint8Array(logoPng),
  });
}

/**
 * Render a structured Scout report payload to a PDF Buffer.
 *
 * Delegates the synchronous CPU-heavy work (chart rasterisation +
 * @react-pdf/renderer layout) to a long-lived worker thread so the Fastify
 * event loop stays responsive during the 10–30s per render. From the
 * caller's POV this is just an async function returning a Buffer; the
 * queueing + worker lifecycle is invisible.
 *
 * `chartSpecs` is a Record<chartId, ChartSpec> populated by the report
 * agent's chart_render tool calls. Each chartId referenced from
 * payload.ourPlayersCharts / theirPlayersCharts must resolve here; entries
 * not referenced by the payload are ignored.
 */
export async function renderScoutReportPdf(
  payload: ScoutReportPayload,
  chartSpecs: ChartSpecsByChartId,
): Promise<Buffer> {
  const generatedAt = format(new Date(), "d MMM yyyy, HH:mm");
  return new Promise<Buffer>((resolve, reject) => {
    queue.push({
      id: nextId++,
      payload,
      chartSpecs,
      generatedAt,
      resolve,
      reject,
    });
    pump();
  });
}

/**
 * Tear down the worker. Used by tests and graceful shutdown — production
 * doesn't need to call this; the worker exits when the parent does.
 */
export async function shutdownPdfWorker(): Promise<void> {
  if (!worker) return;
  const err = new Error("PDF worker shutting down");
  for (const job of inFlight.values()) job.reject(err);
  inFlight.clear();
  queue.splice(0, queue.length).forEach((j) => j.reject(err));
  busy = false;
  const w = worker;
  worker = null;
  await w.terminate();
}
