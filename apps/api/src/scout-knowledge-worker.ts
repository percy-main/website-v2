/**
 * Standalone entry point for the Scout knowledge-base ingestion worker.
 * Designed to run as an ECS RunTask invocation, one task per uploaded
 * document.
 *
 * Reads KB_DOCUMENT_ID from process.env (injected via ECS
 * containerOverrides). Parses the same Config schema as the API
 * server, so SCOUT_KB_* / VOYAGE_* / S3 / Anthropic settings carry
 * over unchanged.
 *
 * Mirrors scout-report-worker.ts. No wall-clock kill — KB ingest is
 * bounded by document size + chunk count, both of which are capped by
 * config (SCOUT_KB_MAX_DOCUMENT_BYTES, SCOUT_KB_MAX_PDF_PAGES). If we
 * see hangs in production, add the same RENDER_MARGIN_MS-style
 * backstop the report worker carries.
 */

import { context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import { createClient } from "@percy-main/db";
import { parseConfig } from "./config.ts";
import { createVoyageClient } from "./features/scout/facts/voyage.ts";
import { runIngest } from "./features/scout/knowledge/run-ingest.ts";
import { resolveModel } from "./features/scout/provider.ts";
import { createS3KnowledgeBaseStore } from "./lib/s3-knowledge-base.ts";
import { createWorkerLogger } from "./lib/worker-logger.ts";

/**
 * Extract the propagated W3C trace context from env vars set by the
 * launcher (#197). See scout-report-worker.ts for the full rationale.
 */
function extractTraceContext() {
  const carrier: Record<string, string> = {};
  if (process.env.OTEL_TRACEPARENT) {
    carrier.traceparent = process.env.OTEL_TRACEPARENT;
  }
  if (process.env.OTEL_TRACESTATE) {
    carrier.tracestate = process.env.OTEL_TRACESTATE;
  }
  return propagation.extract(ROOT_CONTEXT, carrier);
}

const DOCUMENT_ID = process.env.KB_DOCUMENT_ID;
if (!DOCUMENT_ID) {
  console.error("Missing required env var: KB_DOCUMENT_ID");
  process.exit(1);
}

const config = parseConfig(process.env);

if (!config.VOYAGE_API_KEY) {
  console.error(
    "Missing required env var: VOYAGE_API_KEY (KB ingest needs embeddings)",
  );
  process.exit(1);
}

const { client: db } = createClient(config.DATABASE_URL);
const voyage = createVoyageClient({
  apiKey: config.VOYAGE_API_KEY,
  embedModel: config.VOYAGE_EMBED_MODEL,
  rerankModel: config.VOYAGE_RERANK_MODEL,
});
// Anthropic-backed Haiku used for image captioning + PDF extraction.
// Optional — text/markdown documents only need Voyage. runIngest
// fails the row with a clear error if it gets here for an image/pdf
// without Anthropic.
const anthropicModel = config.ANTHROPIC_API_KEY
  ? resolveModel("anthropic", config.SCOUT_ATTACHMENT_DERIVE_MODEL).model
  : null;
const scoutKnowledgeBase = createS3KnowledgeBaseStore(config);
const logger = createWorkerLogger("scout-knowledge-worker");
const parentCtx = extractTraceContext();

logger.info({ documentId: DOCUMENT_ID }, "scout_kb_worker_started");

try {
  await context.with(parentCtx, () =>
    runIngest(
      { db, voyage, anthropicModel, scoutKnowledgeBase, config, logger },
      DOCUMENT_ID,
    ),
  );
  logger.info({ documentId: DOCUMENT_ID }, "scout_kb_worker_done");
  await db.destroy();
  process.exit(0);
} catch (err) {
  // runIngest persists the failure to the row before throwing, so this
  // catch is purely about exit code + log. Unhandled errors here mean
  // something outside the pipeline (boot, DB connect) blew up; the
  // row's status is the source of truth for downstream observers.
  logger.error({ err, documentId: DOCUMENT_ID }, "scout_kb_worker_failed");
  await db.destroy().catch(() => undefined);
  process.exit(1);
}
