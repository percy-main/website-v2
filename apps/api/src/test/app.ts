import type { DB } from "@percy-main/db";
import type { Kysely, PostgresDialect } from "kysely";
import { buildApp } from "../app.ts";
import { parseConfig } from "../config.ts";

/**
 * Creates a test Fastify app backed by the given database.
 * Uses the real app builder with test-appropriate config.
 */
export async function buildTestApp(db: Kysely<DB>, dialect: PostgresDialect) {
  const config = parseConfig({
    DATABASE_URL: "test://unused", // DB is injected directly
    NODE_ENV: "test",
    EMAIL_PROVIDER: "dev",
    BASE_URL: "http://localhost:5173",
    API_BASE_URL: "http://localhost:3000",
    LOG_LEVEL: "error",
    STRIPE_SECRET_KEY: "unused-stripe-key",
    S3_BUCKET: "test-bucket",
    S3_DOCUMENTS_BUCKET: "test-documents-bucket",
    S3_DOCUMENT_UPLOADS_BUCKET: "test-document-uploads-bucket",
    SCOUT_REPORTS_BUCKET: "test-scout-reports-bucket",
    SCOUT_ATTACHMENT_UPLOADS_BUCKET: "test-scout-attachment-uploads-bucket",
    SCOUT_ATTACHMENTS_BUCKET: "test-scout-attachments-bucket",
    SCOUT_KB_UPLOADS_BUCKET: "test-scout-kb-uploads-bucket",
    SCOUT_KB_BUCKET: "test-scout-kb-bucket",
    // Models are required (no in-code defaults). Pin to the production
    // values so tests exercise the real model ids.
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
    TAVILY_API_KEY: "test-tavily-key",
    PHOENIX_API_KEY: "test-phoenix-key",
    PHOENIX_COLLECTOR_ENDPOINT: "http://localhost:6006/v1/traces",
    PHOENIX_PROJECT_NAME: "percy-main-scout-test",
    VAPID_PUBLIC_KEY:
      "BJk5OBwHXbimx6NVTZT-4dLvrm9PkYCu1n3g-4KfRpkqSefZWi_b34N2JzEqvh0lEXTghy5NI8BLdGfhsa7iPvk",
    VAPID_PRIVATE_KEY: "5zXXF30AFmWdn5V-K_W8spVINdk405SAyjSp5_a6aek",
    VAPID_SUBJECT: "mailto:test@example.com",
  });

  return buildApp({ db, dialect, config });
}
