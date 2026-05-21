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
  SCOUT_KB_UPLOADS_BUCKET: "x",
  SCOUT_KB_BUCKET: "x",
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
  TAVILY_API_KEY: "tvly-test",
  PHOENIX_API_KEY: "phx-test",
  PHOENIX_COLLECTOR_ENDPOINT: "http://localhost:6006/v1/traces",
  PHOENIX_PROJECT_NAME: "percy-main-scout-test",
  VAPID_PUBLIC_KEY: "BTestPublicKey_PlaceholderForUnitTestsOnly",
  VAPID_PRIVATE_KEY: "TestPrivateKey_PlaceholderForUnitTestsOnly",
  VAPID_SUBJECT: "mailto:test@example.com",
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

describe("parseConfig — required model config", () => {
  it("rejects missing SCOUT_MODEL_CHAT", () => {
    const env = { ...baseEnv } as Record<string, string | undefined>;
    delete env.SCOUT_MODEL_CHAT;
    expect(() => parseConfig(env)).toThrow();
  });

  it("rejects missing SCOUT_PROVIDER_REPORT", () => {
    const env = { ...baseEnv } as Record<string, string | undefined>;
    delete env.SCOUT_PROVIDER_REPORT;
    expect(() => parseConfig(env)).toThrow();
  });

  it("rejects missing VOYAGE_EMBED_MODEL", () => {
    const env = { ...baseEnv } as Record<string, string | undefined>;
    delete env.VOYAGE_EMBED_MODEL;
    expect(() => parseConfig(env)).toThrow();
  });

  it("rejects missing TAVILY_API_KEY", () => {
    const env = { ...baseEnv } as Record<string, string | undefined>;
    delete env.TAVILY_API_KEY;
    expect(() => parseConfig(env)).toThrow();
  });

  it("rejects missing PHOENIX_API_KEY", () => {
    const env = { ...baseEnv } as Record<string, string | undefined>;
    delete env.PHOENIX_API_KEY;
    expect(() => parseConfig(env)).toThrow();
  });

  it("rejects missing PHOENIX_COLLECTOR_ENDPOINT", () => {
    const env = { ...baseEnv } as Record<string, string | undefined>;
    delete env.PHOENIX_COLLECTOR_ENDPOINT;
    expect(() => parseConfig(env)).toThrow();
  });

  it("rejects missing PHOENIX_PROJECT_NAME", () => {
    const env = { ...baseEnv } as Record<string, string | undefined>;
    delete env.PHOENIX_PROJECT_NAME;
    expect(() => parseConfig(env)).toThrow();
  });
});
