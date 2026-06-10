import { z } from "zod";

/**
 * Treat the literal string "placeholder" (and "") as if the env var
 * was unset. SSM parameter resources in Terraform are created with
 * `value = "placeholder"` so they exist before an operator sets the
 * real value; without this filter, Zod's url() schema would reject
 * "placeholder" and crash the API on the first deploy where a new
 * SSM ref lands in the task definition.
 *
 * Implementation: a string-shaped Zod transform that returns
 * undefined for the sentinel values, validates the URL otherwise.
 */
const optionalPlaceholderUrl = z
  .string()
  .optional()
  .transform((v) => (v === "placeholder" || v === "" ? undefined : v))
  .pipe(z.url().optional());

const optionalPlaceholderString = z
  .string()
  .optional()
  .transform((v) => (v === "placeholder" || v === "" ? undefined : v));

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
  // Additional public origins served by the same better-auth session
  // (matchday PWA at matchday.percymain.org, www apex). Wildcard cert
  // and cross-subdomain cookies make these share the cookie scoped to
  // ".percymain.org". Both optional so dev / preview can omit them.
  MATCHDAY_URL: optionalPlaceholderUrl,
  WWW_URL: optionalPlaceholderUrl,
  // Cookie domain for cross-subdomain better-auth sessions. In prod set
  // to ".percymain.org"; in dev to ".localhost" (browsers treat *.localhost
  // as cookieable). Leaving this unset (or at "placeholder") keeps the
  // API in single-origin mode.
  COOKIE_DOMAIN: optionalPlaceholderString,
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

  // S3 (editor-uploaded content images). Reuses the CloudFront-served
  // uploads bucket (S3_BUCKET). Key prefixes are deliberately NOT
  // configurable - they are structural, coupled to the CloudFront
  // /uploads/* routing and the Terraform lifecycle rule (see
  // lib/s3-content-images.ts).
  CONTENT_IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  CONTENT_IMAGE_UPLOAD_URL_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(900),

  // S3 (policy documents)
  S3_DOCUMENTS_BUCKET: z.string().min(1),
  S3_DOCUMENTS_PREFIX: z.string().default("documents"),
  S3_DOCUMENT_UPLOADS_BUCKET: z.string().min(1),

  // S3 (Scout-generated PDF reports)
  SCOUT_REPORTS_BUCKET: z.string().min(1),
  SCOUT_REPORTS_PREFIX: z.string().default("reports"),

  // S3 (Scout chat attachments — image / PDF originals + browser uploads)
  SCOUT_ATTACHMENT_UPLOADS_BUCKET: z.string().min(1),
  SCOUT_ATTACHMENTS_BUCKET: z.string().min(1),
  SCOUT_ATTACHMENTS_PREFIX: z.string().default("scout/attachments"),
  SCOUT_ATTACHMENT_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  SCOUT_ATTACHMENT_MAX_PDF_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  SCOUT_ATTACHMENT_DERIVE_MAX_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(1500),
  SCOUT_ATTACHMENT_DERIVED_TEXT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(256_000),
  SCOUT_ATTACHMENT_UPLOAD_URL_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(900),
  // Anthropic-only — image / PDF input is on Anthropic regardless of
  // SCOUT_PROVIDER_CHAT, so the deriver gets a dedicated model id rather
  // than reusing SCOUT_MODEL_SUBAGENT (which tracks the sub-agent provider
  // and may be a deepseek id when the captain is running everything on DS).
  SCOUT_ATTACHMENT_DERIVE_MODEL: z.string().min(1),
  SCOUT_ATTACHMENT_MAX_PER_TURN: z.coerce.number().int().positive().default(4),

  // S3 (Scout knowledge base — admin-uploaded PDFs / images / text the
  // agent retrieves chunks from via knowledge_search). Two buckets,
  // mirroring the attachments pattern: a 24h-lifecycle uploads bucket
  // for browser-direct PUTs and a permanent bucket the worker copies
  // committed bytes into.
  SCOUT_KB_UPLOADS_BUCKET: z.string().min(1),
  SCOUT_KB_BUCKET: z.string().min(1),
  SCOUT_KB_PREFIX: z.string().default("scout/knowledge"),
  // Hard cap on a single document. PDFs and images both gate on this
  // single value — the practical ceiling is dictated by Voyage embed
  // throughput on the worker, not the upload itself.
  SCOUT_KB_MAX_DOCUMENT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  // Chunking knobs. 600/100 is a starting guess — bench retrieval
  // quality on a handful of representative docs before locking it in.
  SCOUT_KB_CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(600),
  SCOUT_KB_CHUNK_OVERLAP_TOKENS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(100),
  SCOUT_KB_EMBED_BATCH_SIZE: z.coerce.number().int().positive().default(64),
  SCOUT_KB_UPLOAD_URL_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(900),
  // The KB ingestion worker reuses the API task definition + cluster /
  // subnets / security group from SYNC_ECS_*, just like the report
  // worker - only the container command + per-task env override differ.
  // The plan called for a dedicated SCOUT_KB_WORKER_TASK_DEFINITION,
  // but since the report worker already shares the API service config
  // and that has held up fine, we follow the same pattern here. If KB
  // ingest ever needs different CPU / memory we'll split task
  // definitions then.

  // Observability (New Relic via OpenTelemetry)
  NEW_RELIC_LICENSE_KEY: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default("https://otlp.eu01.nr-data.net"),
  OTEL_SERVICE_NAME: z.string().default("percy-main-api"),

  // Arize Phoenix LLM tracing - isolated from the New Relic pipeline. The
  // Phoenix tracer is only constructed when PHOENIX_API_KEY is set; AI SDK
  // calls that receive it via experimental_telemetry.tracer emit spans
  // exclusively to Phoenix.
  PHOENIX_API_KEY: z.string().min(1),
  PHOENIX_COLLECTOR_ENDPOINT: z.url(),
  PHOENIX_PROJECT_NAME: z.string().min(1),

  // Better Auth Dash (infra plugin — optional, only enabled when API key is set)
  BETTER_AUTH_API_KEY: z.string().optional(),

  // Web Push (VAPID). Public + private keypair identifies this application
  // server to the browser push services. Generated once via
  // `npx web-push generate-vapid-keys` and stored: public key in SSM (the
  // matchday app fetches it from /push/public-key before subscribing),
  // private key in app_secrets Secrets Manager blob. VAPID_SUBJECT is a
  // `mailto:` URL push services use to reach us if a push is misbehaving.
  //
  // All three are validated by *shape* at boot (not just non-empty) so a
  // deploy that forgets to populate the SSM/Secrets values - Terraform
  // seeds them as the literal string "placeholder" - fails fast at task
  // startup instead of silently breaking PushManager.subscribe() in the
  // browser at first opt-in. Public key is 65 raw bytes (~87 base64url
  // chars), private key is 32 raw bytes (~43 base64url chars).
  VAPID_PUBLIC_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{80,90}$/,
      "VAPID_PUBLIC_KEY must be a base64url-encoded P-256 public key (~87 chars)",
    ),
  VAPID_PRIVATE_KEY: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{40,50}$/,
      "VAPID_PRIVATE_KEY must be a base64url-encoded P-256 private key (~43 chars)",
    ),
  VAPID_SUBJECT: z
    .string()
    .regex(/^mailto:.+@.+/, "VAPID_SUBJECT must be a mailto: URL"),

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
  // Provider + model id for each Scout agent surface. All required and
  // explicit — no in-code defaults — so prod / staging / local config
  // stays the single source of truth and a wrong-by-default deployment
  // can't paper over a missing env var.
  SCOUT_PROVIDER_CHAT: z.enum(["anthropic", "deepseek"]),
  SCOUT_PROVIDER_SUBAGENT: z.enum(["anthropic", "deepseek"]),
  SCOUT_PROVIDER_DB: z.enum(["anthropic", "deepseek"]),
  SCOUT_PROVIDER_REPORT: z.enum(["anthropic", "deepseek"]),
  SCOUT_MODEL_CHAT: z.string().min(1),
  SCOUT_MODEL_SUBAGENT: z.string().min(1),
  SCOUT_MODEL_DB: z.string().min(1),
  SCOUT_MODEL_REPORT: z.string().min(1),
  // ask_db sub-agent step cap. A typical question takes 3-5 steps:
  // db_list_tables, 1-2 db_describe_table, 1-2 db_run_sql (often a first
  // query returns 0 rows due to a wrong filter, prompting one refinement).
  // Default 8 was tight enough to fire "ran out of steps mid-loop" warnings
  // during normal researcher runs; 14 leaves real headroom without
  // encouraging the model to keep poking indefinitely.
  SCOUT_DB_AGENT_MAX_STEPS: z.coerce.number().int().positive().default(14),
  SCOUT_MAX_STEPS: z.coerce.number().int().positive().default(20),
  // Report agent step ceiling (the loop behind generate_report). Gathers
  // Wall-clock cap on the report agent. DeepSeek can hold a single
  // chat-completions request open for minutes; without a timeout one slow
  // step locks the whole generate_report flow indefinitely. The agent
  // loop has no step cap (just a 500-step sanity backstop in code) — this
  // wall-clock budget is the real cost ceiling. 30 minutes covers a long
  // opposition walk + drafts + refinement; longer than that and something
  // is wedged.
  SCOUT_REPORT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_800_000),
  // Dev-only flag, kept for parity with older scripts. The report agent
  // no longer has a step cap to clamp; flipping this on is currently a
  // no-op but the env var stays so SCOUT_DEV_FAST=true scripts don't
  // start failing zod validation. Never enable in prod.
  SCOUT_DEV_FAST: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Voyage AI (fact-RAG embeddings + reranking). API key is optional —
  // Scout boots without it and just skips the fact tools and KB
  // retrieval. Model ids are required and must be set explicitly so a
  // wrong-by-default deployment can't mismatch the embedding stored in
  // pgvector with the model used to query it.
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_EMBED_MODEL: z.string().min(1),
  VOYAGE_RERANK_MODEL: z.string().min(1),

  // Tavily (Scout recognition-source discovery). See ADR 042.
  TAVILY_API_KEY: z.string().min(1),

  // Sync task launch (admin "Sync now" button → ECS RunTask)
  AWS_REGION: z.string().default("eu-west-2"),
  SYNC_ECS_CLUSTER: z.string().optional(),
  // Service name used to resolve the running task-def revision via
  // DescribeServices. RunTask receives that specific revision instead
  // of the family name, so workers always run the same image the API
  // is running (and dodge stray Terraform-registered revisions that
  // point at the no-longer-published `:latest` tag).
  SYNC_ECS_SERVICE: z.string().optional(),
  SYNC_ECS_SUBNETS: z.string().optional(), // comma-separated
  SYNC_ECS_SECURITY_GROUP: z.string().optional(),
  SYNC_ECS_ASSIGN_PUBLIC_IP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parse and validate configuration from an environment object.
 * In production, pass process.env. In tests, pass a minimal object.
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  return configSchema.parse(env);
}
