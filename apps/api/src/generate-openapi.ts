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
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  S3_BUCKET: "placeholder",
  S3_DOCUMENTS_BUCKET: "placeholder",
  S3_DOCUMENT_UPLOADS_BUCKET: "placeholder",
  SCOUT_REPORTS_BUCKET: "placeholder",
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
