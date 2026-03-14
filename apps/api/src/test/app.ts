import type { DB } from "@percy-main/db";
import type { Kysely, PostgresDialect } from "kysely";
import { buildApp } from "../app.js";
import { parseConfig } from "../config.js";

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
    LOG_LEVEL: "error",
  });

  return buildApp({ db, dialect, config });
}
