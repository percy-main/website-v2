/**
 * Generates the OpenAPI spec by booting the Fastify app without listening.
 * Writes openapi.json to stdout so it can be piped to openapi-typescript.
 *
 * Usage: tsx apps/api/src/generate-openapi.ts > openapi.json
 */

import { createClient } from "@percy-main/db";
import { buildApp } from "./app.ts";
import { parseConfig } from "./config.ts";

const config = parseConfig({
  DATABASE_URL: "postgres://percy:percy@localhost:5433/percy_main",
  API_BASE_URL: "http://localhost:3000",
  // Trivy's stripe-secret-token rule matches any `sk_test_*` literal —
  // even an obvious placeholder — and fails the deploy. The OpenAPI
  // generator boots the app but never calls Stripe, so any non-empty
  // string satisfies z.string() in config.
  STRIPE_SECRET_KEY: "openapi-generator-placeholder",
  S3_BUCKET: "placeholder",
  S3_DOCUMENTS_BUCKET: "placeholder",
  S3_DOCUMENT_UPLOADS_BUCKET: "placeholder",
  SCOUT_REPORTS_BUCKET: "placeholder",
  SCOUT_ATTACHMENT_UPLOADS_BUCKET: "placeholder",
  SCOUT_ATTACHMENTS_BUCKET: "placeholder",
  SCOUT_KB_UPLOADS_BUCKET: "placeholder",
  SCOUT_KB_BUCKET: "placeholder",
  SCOUT_PROVIDER_CHAT: "deepseek",
  SCOUT_PROVIDER_SUBAGENT: "deepseek",
  SCOUT_PROVIDER_DB: "anthropic",
  SCOUT_PROVIDER_REPORT: "deepseek",
  SCOUT_MODEL_CHAT: "deepseek-v4-pro",
  SCOUT_MODEL_SUBAGENT: "deepseek-v4-pro",
  SCOUT_MODEL_DB: "claude-haiku-4-5-20251001",
  SCOUT_MODEL_REPORT: "deepseek-v4",
  SCOUT_ATTACHMENT_DERIVE_MODEL: "claude-haiku-4-5-20251001",
  VOYAGE_EMBED_MODEL: "voyage-4",
  VOYAGE_RERANK_MODEL: "rerank-2.5",
  NODE_ENV: "development",
  LOG_LEVEL: "error",
  PLAY_CRICKET_API_TOKEN: "placeholder",
  PLAY_CRICKET_SITE_ID: "0",
});

const { client: db, dialect } = createClient(config.DATABASE_URL);
const app = await buildApp({ db, dialect, config });

await app.ready();

const spec = app.swagger();
process.stdout.write(JSON.stringify(spec, null, 2));

await app.close();
process.exit(0);
