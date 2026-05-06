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

import { createClient } from "@percy-main/db";
import { parseConfig } from "./config.ts";
import { createVoyageClient } from "./features/scout/facts/voyage.ts";
import { runIngest } from "./features/scout/knowledge/run-ingest.ts";
import { resolveModel } from "./features/scout/provider.ts";
import { createS3KnowledgeBaseStore } from "./lib/s3-knowledge-base.ts";

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
if (!config.ANTHROPIC_API_KEY) {
  console.error(
    "Missing required env var: ANTHROPIC_API_KEY (KB image captioning is Anthropic-only)",
  );
  process.exit(1);
}

const { client: db } = createClient(config.DATABASE_URL);
const voyage = createVoyageClient({
  apiKey: config.VOYAGE_API_KEY,
  embedModel: config.VOYAGE_EMBED_MODEL,
  rerankModel: config.VOYAGE_RERANK_MODEL,
});
// Image captioning is Anthropic-only regardless of SCOUT_PROVIDER_*.
// Reuse the chat-attachment derive model id — same prompt-shape, same
// token budget, just a longer prompt for KB use.
const { model: imageCaptionModel } = resolveModel(
  "anthropic",
  config.SCOUT_ATTACHMENT_DERIVE_MODEL,
);
const scoutKnowledgeBase = createS3KnowledgeBaseStore(config);

console.log(`scout_kb_worker_started documentId=${DOCUMENT_ID}`);

try {
  await runIngest(
    { db, voyage, imageCaptionModel, scoutKnowledgeBase, config },
    DOCUMENT_ID,
  );
  console.log(`scout_kb_worker_done documentId=${DOCUMENT_ID}`);
  await db.destroy();
  process.exit(0);
} catch (err) {
  // runIngest persists the failure to the row before throwing, so this
  // catch is purely about exit code + log. Unhandled errors here mean
  // something outside the pipeline (boot, DB connect) blew up; the
  // row's status is the source of truth for downstream observers.
  console.error("scout_kb_worker_failed", err);
  await db.destroy().catch(() => undefined);
  process.exit(1);
}
