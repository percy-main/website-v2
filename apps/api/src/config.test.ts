import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.ts";

const baseEnv = {
  DATABASE_URL: "postgres://localhost/x",
  COOKIE_SECRET: "x".repeat(32),
  API_BASE_URL: "http://localhost:3001",
  STRIPE_SECRET_KEY: "sk_test_x",
  S3_BUCKET: "x",
  S3_DOCUMENTS_BUCKET: "x",
  S3_DOCUMENT_UPLOADS_BUCKET: "x",
  SCOUT_REPORTS_BUCKET: "x",
  SCOUT_ATTACHMENT_UPLOADS_BUCKET: "x",
  SCOUT_ATTACHMENTS_BUCKET: "x",
};

describe("parseConfig — defaults", () => {
  it("uses sensible defaults for the report agent budget", () => {
    const config = parseConfig(baseEnv);
    expect(config.SCOUT_REPORT_TIMEOUT_MS).toBe(1_800_000);
    expect(config.SCOUT_DB_AGENT_MAX_STEPS).toBe(14);
  });

  it("respects an explicit SCOUT_REPORT_TIMEOUT_MS env override", () => {
    const config = parseConfig({
      ...baseEnv,
      SCOUT_REPORT_TIMEOUT_MS: "120000",
    });
    expect(config.SCOUT_REPORT_TIMEOUT_MS).toBe(120_000);
  });

  it("parses SCOUT_DEV_FAST as boolean (no-op flag retained for env stability)", () => {
    expect(
      parseConfig({ ...baseEnv, SCOUT_DEV_FAST: "true" }).SCOUT_DEV_FAST,
    ).toBe(true);
    expect(parseConfig(baseEnv).SCOUT_DEV_FAST).toBe(false);
  });
});
