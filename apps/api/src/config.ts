import { REPORT_PHASE_BUDGETS_MS } from "@percy-main/shared";
import { z } from "zod";

const configSchema = z.object({
  // Database
  DATABASE_URL: z
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
  BASE_URL: z.url().default("http://localhost:5173"),
  API_BASE_URL: z.url(),
  DEPLOY_PRIME_URL: z.url().optional(),
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
  S3_ENDPOINT: z.url().optional(),

  // S3 (policy documents)
  S3_DOCUMENTS_BUCKET: z.string().min(1),
  S3_DOCUMENTS_PREFIX: z.string().default("documents"),
  S3_DOCUMENT_UPLOADS_BUCKET: z.string().min(1),

  // S3 (Scout-generated PDF reports)
  SCOUT_REPORTS_BUCKET: z.string().min(1),
  SCOUT_REPORTS_PREFIX: z.string().default("reports"),

  // Observability (New Relic via OpenTelemetry)
  NEW_RELIC_LICENSE_KEY: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default("https://otlp.eu01.nr-data.net"),
  OTEL_SERVICE_NAME: z.string().default("percy-main-api"),

  // Better Auth Dash (infra plugin — optional, only enabled when API key is set)
  BETTER_AUTH_API_KEY: z.string().optional(),

  // External services
  SLACK_WEBHOOK_URL: z.url().optional(),
  PLAY_CRICKET_API_TOKEN: z.string().optional(),
  PLAY_CRICKET_SITE_ID: z.string().optional(),

  // Google Ads (offline conversion uploads)
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN: z.string().optional(),

  // Scout (AI analyst — alex-only for now)
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  SCOUT_DB_URL: z.url().optional(),
  // Provider/model are split so the chat agent and the title sub-agent can
  // run on different vendors. Flip SCOUT_PROVIDER_CHAT=deepseek + set
  // SCOUT_MODEL_CHAT to a deepseek model id (e.g. deepseek-chat) to swap.
  SCOUT_PROVIDER_CHAT: z.enum(["anthropic", "deepseek"]).default("anthropic"),
  SCOUT_PROVIDER_SUBAGENT: z
    .enum(["anthropic", "deepseek"])
    .default("anthropic"),
  // Provider/model for the DB sub-agent — runs the SQL loop behind the
  // ask_db tool. Default Claude Haiku, which is strong at SQL and cheap.
  // Independent from the chat agent so the main loop can run on a frontier
  // model while DB queries stay on a cheap fast one.
  SCOUT_PROVIDER_DB: z.enum(["anthropic", "deepseek"]).default("anthropic"),
  // Provider/model for the Play Cricket sub-agent — runs the pc_* loop
  // behind the ask_play_cricket tool. Same rationale as SCOUT_PROVIDER_DB:
  // Haiku is fast and good at picking the right pc_* tool / projection,
  // and isolating the loop keeps failed projections out of the main chat.
  SCOUT_PROVIDER_PC: z.enum(["anthropic", "deepseek"]).default("anthropic"),
  // Researcher phase (the loop behind generate_report). Independent from the
  // chat agent so the researcher can run on a faster/cheaper model — its job
  // is structured data extraction and tool-calling, not deep reasoning.
  // Default DeepSeek flash so prod mirrors dev without needing a Terraform /
  // env override; override via env when the researcher needs more horsepower.
  SCOUT_PROVIDER_RESEARCHER: z
    .enum(["anthropic", "deepseek"])
    .default("deepseek"),
  // Analyst phase. Reads the researcher's evidence packet (no tools) and
  // emits the report content + claims registry. Default flash too — the job
  // is mechanical synthesis (read evidence, populate template, attach claim
  // citations), not deep reasoning, and the prompt carries a large evidence
  // packet inline that v4-pro with thinking takes minutes to chew through.
  SCOUT_PROVIDER_ANALYST: z.enum(["anthropic", "deepseek"]).default("deepseek"),
  SCOUT_MODEL_CHAT: z.string().default("claude-sonnet-4-6"),
  SCOUT_MODEL_SUBAGENT: z.string().default("claude-haiku-4-5-20251001"),
  SCOUT_MODEL_DB: z.string().default("claude-haiku-4-5-20251001"),
  SCOUT_MODEL_PC: z.string().default("claude-haiku-4-5-20251001"),
  SCOUT_MODEL_RESEARCHER: z.string().default("deepseek-v4-flash"),
  SCOUT_MODEL_ANALYST: z.string().default("deepseek-v4-flash"),
  // ask_db sub-agent step cap. A typical question takes 3-5 steps:
  // db_list_tables, 1-2 db_describe_table, 1-2 db_run_sql (often a first
  // query returns 0 rows due to a wrong filter, prompting one refinement).
  // Default 8 was tight enough to fire "ran out of steps mid-loop" warnings
  // during normal researcher runs; 14 leaves real headroom without
  // encouraging the model to keep poking indefinitely.
  SCOUT_DB_AGENT_MAX_STEPS: z.coerce.number().int().positive().default(14),
  // Most PC questions resolve in 1-3 calls (one fetch, sometimes a site_id
  // pivot beforehand). 6 leaves headroom for an opposition-scout chain
  // without inviting the sub-agent to keep poking.
  SCOUT_PC_AGENT_MAX_STEPS: z.coerce.number().int().positive().default(6),
  SCOUT_MAX_STEPS: z.coerce.number().int().positive().default(20),
  // Researcher phase (the loop behind generate_report). Gathers evidence via
  // ask_db / pc_* / weather_get / fact_retrieve and emits records via the
  // record_evidence tool. Default 30 — selection + 4-5 opposition matches +
  // a few player aggregates + weather + facts, with one record_evidence per
  // datum, rarely needs more.
  SCOUT_RESEARCHER_MAX_STEPS: z.coerce.number().int().positive().default(30),
  // Wall-clock caps per phase. DeepSeek can hold a single chat-completions
  // request open for minutes; without timeouts one slow step locks the whole
  // generate_report flow indefinitely. Defaults sourced from
  // REPORT_PHASE_BUDGETS_MS in @percy-main/shared so the FE pipeline-card
  // countdown uses the same numbers — never shows "over budget" while the
  // BE still has headroom.
  SCOUT_RESEARCHER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(REPORT_PHASE_BUDGETS_MS.researcher),
  SCOUT_ANALYST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(REPORT_PHASE_BUDGETS_MS.analyst),
  // Dev-only: clamp every researcher / sub-agent step cap to a tiny budget
  // so end-to-end smoke runs locally in ~1-2 minutes instead of 10+. Reports
  // produced under this flag will be thin (less evidence gathered) but the
  // pipeline shape is identical, so it's the right loop for iterating on
  // prompt / validator / rendering changes. Never enable in prod.
  SCOUT_DEV_FAST: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Voyage AI (fact-RAG embeddings + reranking). Optional — Scout boots
  // without it and just skips the fact tools / auto-retrieval.
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_EMBED_MODEL: z.string().default("voyage-4"),
  VOYAGE_RERANK_MODEL: z.string().default("rerank-2.5"),

  // Sync task launch (admin "Sync now" button → ECS RunTask)
  AWS_REGION: z.string().default("eu-west-2"),
  SYNC_ECS_CLUSTER: z.string().optional(),
  SYNC_ECS_TASK_DEFINITION: z.string().optional(),
  SYNC_ECS_SUBNETS: z.string().optional(), // comma-separated
  SYNC_ECS_SECURITY_GROUP: z.string().optional(),
  SYNC_ECS_ASSIGN_PUBLIC_IP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * When SCOUT_DEV_FAST=true is set, clamp the researcher + sub-agent step
 * caps to tiny values so a local smoke run finishes in ~1-2 min. Anything
 * already smaller than the clamp is left alone (you can always go lower
 * via the individual env vars). Timeouts are not clamped — step caps will
 * stop the loops well before the wall-clock fires anyway.
 */
const DEV_FAST_STEP_CAPS = {
  // Researcher is the long-running loop (multi-minute) — clamp it so a smoke
  // run finishes fast. Sub-agents are short and bounded already; clamping
  // them just makes them stop mid-loop with planning prose as their summary.
  // Leave PC + DB sub-agents at their prod defaults.
  SCOUT_RESEARCHER_MAX_STEPS: 6,
} as const;

/**
 * Parse and validate configuration from an environment object.
 * In production, pass process.env. In tests, pass a minimal object.
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const config = configSchema.parse(env);
  if (config.SCOUT_DEV_FAST) {
    for (const [key, cap] of Object.entries(DEV_FAST_STEP_CAPS) as Array<
      [keyof typeof DEV_FAST_STEP_CAPS, number]
    >) {
      if (config[key] > cap) config[key] = cap;
    }
  }
  return config;
}
