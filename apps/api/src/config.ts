import { z } from "zod";

const configSchema = z.object({
  // Database
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://percy:percy@localhost:5433/percy_main"),

  // Server
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Auth
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_RP_ID: z.string().default("localhost"),
  BETTER_AUTH_RP_NAME: z.string().default("Percy Main CSC"),
  BASE_URL: z.string().url().default("http://localhost:5173"),
  API_BASE_URL: z.string().url(),
  DEPLOY_PRIME_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),

  // Stripe
  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Email
  EMAIL_PROVIDER: z.enum(["dev", "ses"]).default("dev"),
  SES_REGION: z.string().default("eu-west-2"),
  SES_FROM_ADDRESS: z
    .string()
    .default("Percy Main CSC Support <support@notifications.percymain.org>"),

  // S3 (receipt uploads)
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().default("eu-west-2"),
  S3_RECEIPT_PREFIX: z.string().default("receipts"),
  S3_ENDPOINT: z.string().url().optional(),

  // Observability (New Relic via OpenTelemetry)
  NEW_RELIC_LICENSE_KEY: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .default("https://otlp.eu01.nr-data.net"),
  OTEL_SERVICE_NAME: z.string().default("percy-main-api"),

  // Better Auth Dash (infra plugin — optional, only enabled when API key is set)
  BETTER_AUTH_API_KEY: z.string().optional(),

  // External services
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  PLAY_CRICKET_API_TOKEN: z.string().optional(),
  PLAY_CRICKET_SITE_ID: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parse and validate configuration from an environment object.
 * In production, pass process.env. In tests, pass a minimal object.
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  return configSchema.parse(env);
}
