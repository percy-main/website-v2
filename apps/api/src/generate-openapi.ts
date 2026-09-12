/**
 * Generates the OpenAPI spec by booting the Fastify app without listening.
 * Writes openapi.json to stdout so it can be piped to openapi-typescript.
 *
 * Usage: tsx apps/api/src/generate-openapi.ts > openapi.json
 */

import { createClient } from "@percy-main/db";
import { buildApp } from "./app.ts";
import { parseConfig } from "./config.ts";

// @better-auth/oauth-provider's mcp() plugin seeds its configured
// `resources` row on the real DB as an un-awaited background operation
// during betterAuth() construction — not something app.ts's own code
// calls or can opt out of. Every other DB access in this script is
// through a lazily-connecting Kysely client that's never actually
// queried (matching the placeholder config above), but this one fires
// immediately and rejects with ECONNREFUSED since there's no live DB
// here, which would otherwise crash the process with an unhandled
// rejection before the spec ever gets written to stdout.
process.on("unhandledRejection", (reason) => {
  if (
    reason &&
    typeof reason === "object" &&
    "code" in reason &&
    reason.code === "ECONNREFUSED"
  ) {
    return;
  }
  throw reason;
});

const config = parseConfig({
  DATABASE_URL: "postgres://percy:percy@localhost:5433/percy_main",
  MCP_DB_URL: "postgres://percy:percy@localhost:5433/percy_main",
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
  SCOUT_PROVIDER_REPORT: "deepseek",
  SCOUT_MODEL_CHAT: "deepseek-v4-pro",
  SCOUT_MODEL_SUBAGENT: "deepseek-v4-pro",
  SCOUT_MODEL_REPORT: "deepseek-v4",
  SCOUT_ATTACHMENT_DERIVE_MODEL: "claude-haiku-4-5-20251001",
  CONTENT_AI_PROVIDER: "deepseek",
  CONTENT_AI_MODEL: "deepseek-v4-pro",
  VOYAGE_EMBED_MODEL: "voyage-4",
  VOYAGE_RERANK_MODEL: "rerank-2.5",
  TAVILY_API_KEY: "placeholder",
  PHOENIX_API_KEY: "placeholder",
  PHOENIX_COLLECTOR_ENDPOINT: "http://localhost:6006/v1/traces",
  PHOENIX_PROJECT_NAME: "openapi-generator-placeholder",
  NODE_ENV: "development",
  LOG_LEVEL: "error",
  PLAY_CRICKET_API_TOKEN: "placeholder",
  PLAY_CRICKET_SITE_ID: "0",
  // Real-shape dummy VAPID keypair so config's regex validators pass
  // during spec generation. The OpenAPI run never calls a push service.
  VAPID_PUBLIC_KEY:
    "BJk5OBwHXbimx6NVTZT-4dLvrm9PkYCu1n3g-4KfRpkqSefZWi_b34N2JzEqvh0lEXTghy5NI8BLdGfhsa7iPvk",
  VAPID_PRIVATE_KEY: "5zXXF30AFmWdn5V-K_W8spVINdk405SAyjSp5_a6aek",
  VAPID_SUBJECT: "mailto:openapi-generator@example.com",
});

const { client: db, dialect } = createClient(config.DATABASE_URL);
const app = await buildApp({ db, dialect, config });

await app.ready();

const spec = app.swagger();
process.stdout.write(JSON.stringify(spec, null, 2));

await app.close();
process.exit(0);
