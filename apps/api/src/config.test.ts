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
};

describe("parseConfig — SCOUT_DEV_FAST", () => {
  it("leaves step caps at their defaults when unset", () => {
    const config = parseConfig(baseEnv);
    expect(config.SCOUT_RESEARCHER_MAX_STEPS).toBe(30);
    expect(config.SCOUT_DB_AGENT_MAX_STEPS).toBe(14);
  });

  it("clamps the researcher loop when SCOUT_DEV_FAST=true; leaves sub-agents at prod defaults", () => {
    const config = parseConfig({ ...baseEnv, SCOUT_DEV_FAST: "true" });
    expect(config.SCOUT_RESEARCHER_MAX_STEPS).toBe(6);
    expect(config.SCOUT_DB_AGENT_MAX_STEPS).toBe(14);
  });

  it("respects an explicit env override smaller than the dev-fast clamp", () => {
    const config = parseConfig({
      ...baseEnv,
      SCOUT_DEV_FAST: "true",
      SCOUT_RESEARCHER_MAX_STEPS: "3",
    });
    expect(config.SCOUT_RESEARCHER_MAX_STEPS).toBe(3);
  });
});
