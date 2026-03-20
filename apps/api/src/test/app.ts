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
  });

  return buildApp({ db, dialect, config });
}
