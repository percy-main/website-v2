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
  });

  return buildApp({ db, dialect, config });
}
