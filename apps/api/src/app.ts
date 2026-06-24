import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Tracer } from "@opentelemetry/api";
import { createClient as createDbClient, type DB } from "@percy-main/db";
import { createSend, type Email } from "@percy-main/email";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Kysely, PostgresDialect } from "kysely";
import type { Config } from "./config.ts";
import { createAuth, type Auth } from "./features/auth/auth.ts";
import { errorHandler } from "./lib/error-handler.ts";
import { createPhoenixTracer } from "./lib/phoenix-tracer.ts";
import { createPushSender, type SendPush } from "./lib/push-sender.ts";
import {
  createContentImageStore,
  type ContentImageStore,
} from "./lib/s3-content-images.ts";
import {
  createS3DocumentStore,
  type S3DocumentStore,
} from "./lib/s3-documents.ts";
import {
  createS3KnowledgeBaseStore,
  type S3KnowledgeBaseStore,
} from "./lib/s3-knowledge-base.ts";
import {
  createScoutAttachmentStore,
  type ScoutAttachmentStore,
} from "./lib/s3-scout-attachments.ts";
import {
  createScoutReportStore,
  type ScoutReportStore,
} from "./lib/s3-scout-reports.ts";
import { createS3Uploader, type S3Uploader } from "./lib/s3-upload.ts";

// Feature routes
import { adminRoutes } from "./features/admin/routes.ts";
import { authRoutes } from "./features/auth/routes.ts";
import { availabilityRoutes } from "./features/availability/routes.ts";
import { chargeRoutes } from "./features/charges/routes.ts";
import { contactRoutes } from "./features/contact/routes.ts";
import { contentAuthorRoutes } from "./features/content-author/routes.ts";
import { contentImageRoutes } from "./features/content-images/routes.ts";
import { contentProposalRoutes } from "./features/content-proposal/routes.ts";
import { contentRoutes } from "./features/content/routes.ts";
import { cricketLeaderboardRoutes } from "./features/cricket-leaderboard/routes.ts";
import { documentRoutes } from "./features/documents/routes.ts";
import { fantasyRoutes } from "./features/fantasy/routes.ts";
import { financialReliefRoutes } from "./features/financial-relief/routes.ts";
import { gamesRoutes } from "./features/games/routes.ts";
import { healthRoutes } from "./features/health/routes.ts";
import { incidentReportRoutes } from "./features/incident-report/routes.ts";
import { juniorRoutes } from "./features/junior/routes.ts";
import { leaderboardRoutes } from "./features/leaderboard/routes.ts";
import { createAdsClient } from "./features/marketing/ads-client.ts";
import { startForwarder } from "./features/marketing/forwarder.ts";
import { marketingRoutes } from "./features/marketing/routes.ts";
import { matchdayRoutes } from "./features/matchday/routes.ts";
import { memberRoutes } from "./features/members/routes.ts";
import { membershipRoutes } from "./features/membership/routes.ts";
import { notifPrefsRoutes } from "./features/notification-preferences/routes.ts";
import { ogImageRoutes } from "./features/og-image/routes.ts";
import { paymentRoutes } from "./features/payments/routes.ts";
import { webhookRoutes } from "./features/payments/webhook.ts";
import { playCricketRoutes } from "./features/play-cricket/routes.ts";
import { pushSubscriptionRoutes } from "./features/push-subscriptions/routes.ts";
import { recordsRoutes } from "./features/records/routes.ts";
import { scoutRoutes } from "./features/scout/routes.ts";
import { sponsorshipRoutes } from "./features/sponsorship/routes.ts";
import { treasurerRoutes } from "./features/treasurer/routes.ts";
import { userGroupsRoutes } from "./features/user-groups/routes.ts";

// Extend Fastify types with our decorations
declare module "fastify" {
  interface FastifyInstance {
    db: Kysely<DB>;
    dbReadonly: Kysely<DB> | null;
    config: Config;
    auth: Auth;
    send: (email: Email) => Promise<void>;
    sendPush: SendPush;
    s3: S3Uploader;
    s3Documents: S3DocumentStore;
    scoutReports: ScoutReportStore;
    scoutAttachments: ScoutAttachmentStore;
    scoutKnowledgeBase: S3KnowledgeBaseStore;
    contentImages: ContentImageStore;
    phoenixTracer: Tracer;
  }
}

export interface AppDeps {
  db: Kysely<DB>;
  dialect: PostgresDialect;
  config: Config;
}

/**
 * Builds a fully configured Fastify app.
 * Dependencies are injected — no global singletons.
 */
export async function buildApp({ db, dialect, config }: AppDeps) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Strip PII / secrets at the Pino layer. We need both the
      // top-level paths (log.info({ email })) and the `*.X` wildcards
      // (log.info({ user: { email } })) — Pino wildcards match exactly
      // one path segment, so the bare and prefixed forms are not
      // interchangeable. Headers paths cover OIDC / cookie auth.
      // Add new paths here when a new sensitive field appears in any
      // log call.
      redact: {
        paths: [
          "email",
          "password",
          "passwordHash",
          "token",
          "apiKey",
          "authorization",
          "recipientEmail",
          "*.email",
          "*.password",
          "*.passwordHash",
          "*.token",
          "*.apiKey",
          "*.authorization",
          "*.recipientEmail",
          "*.*.email",
          "*.*.password",
          "*.*.token",
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['set-cookie']",
        ],
        censor: "[REDACTED]",
      },
      // Fastify's default req/res serializers + Pino's default err
      // serializer (which captures stack, type, cause, and enumerable
      // own props on Error subclasses) are inherited when not
      // explicitly overridden — leaving serializers off means we get
      // those defaults plus any custom Error subclass fields
      // (AdsValidationError.fieldErrors, etc).
      transport:
        config.NODE_ENV !== "production"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  // Set up Zod type provider for schema-driven validation + serialization
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Decorate the instance so routes can access deps via `app.db` / `this.db`
  app.decorate("db", db);
  app.decorate("config", config);

  if (config.SCOUT_DEV_FAST) {
    app.log.warn(
      "scout_dev_fast_enabled — currently a no-op (the report agent has no step cap to clamp); flag retained for env-var stability",
    );
  }

  // Optional read-only Kysely client for the Scout feature. Built from
  // SCOUT_DB_URL (a libpq URL using the `scout_readonly` Postgres role created
  // by migration 2026-05-03). Null when unset — Scout routes guard on this.
  const dbReadonly = config.SCOUT_DB_URL
    ? createDbClient(config.SCOUT_DB_URL).client
    : null;
  app.decorate("dbReadonly", dbReadonly);
  if (dbReadonly) {
    app.addHook("onClose", async () => {
      await dbReadonly.destroy();
    });
  }

  // Create and decorate the email sender
  const send = createSend({
    provider: config.EMAIL_PROVIDER,
    sesRegion: config.SES_REGION,
    fromAddress: config.SES_FROM_ADDRESS,
  });
  app.decorate("send", send);

  // Create and decorate the Web Push sender. Same per-app pattern as
  // sendEmail - features call app.sendPush(subscription, payload) and
  // we surface a single retry / gone-detection point here.
  const sendPush = createPushSender({
    publicKey: config.VAPID_PUBLIC_KEY,
    privateKey: config.VAPID_PRIVATE_KEY,
    subject: config.VAPID_SUBJECT,
  });
  app.decorate("sendPush", sendPush);

  // Create and decorate the auth instance
  const auth = createAuth(config, dialect, db, send, app.log);
  app.decorate("auth", auth);

  // Create and decorate the S3 uploader (receipt images)
  const s3 = createS3Uploader(config);
  app.decorate("s3", s3);

  // Create and decorate the S3 document store (policy documents)
  const s3Documents = createS3DocumentStore(config);
  app.decorate("s3Documents", s3Documents);

  // Create and decorate the Scout report store (AI-generated PDFs)
  const scoutReports = createScoutReportStore(config);
  app.decorate("scoutReports", scoutReports);

  // Create and decorate the Scout attachment store (chat image / PDF originals)
  const scoutAttachments = createScoutAttachmentStore(config);
  app.decorate("scoutAttachments", scoutAttachments);

  // Create and decorate the Scout knowledge base store (admin-uploaded
  // reference docs that the agent retrieves chunks from)
  const scoutKnowledgeBase = createS3KnowledgeBaseStore(config);
  app.decorate("scoutKnowledgeBase", scoutKnowledgeBase);

  // Create and decorate the content image store (editor-uploaded images)
  const contentImages = createContentImageStore(config);
  app.decorate("contentImages", contentImages);

  // Isolated tracer provider for LLM spans. New Relic owns the global OTel
  // pipeline; this provider sits alongside it and receives only AI SDK
  // spans via the experimental_telemetry.tracer plumbed through Scout.
  const phoenix = createPhoenixTracer(config);
  app.decorate("phoenixTracer", phoenix.tracer);
  app.addHook("onClose", async () => {
    await phoenix.shutdown();
  });

  // Plugins
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Percy Main API",
        version: "1.0.0",
      },
    },
    transform: jsonSchemaTransform,
  });

  if (config.NODE_ENV !== "production") {
    await app.register(swaggerUi, {
      routePrefix: "/api/docs",
    });
  }

  // CORS — accept any of our trusted public origins. Multiple browser
  // origins (web, matchday, www) share one better-auth session via a
  // cookie scoped to .percymain.org, so the API has to allow each
  // explicitly. Falsy entries (e.g. unset MATCHDAY_URL in dev) are
  // filtered out.
  const allowedOrigins = [
    config.BASE_URL,
    config.MATCHDAY_URL,
    config.WWW_URL,
    config.DEPLOY_PRIME_URL,
  ].filter((u): u is string => Boolean(u));
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser requests (curl, server-side) have no Origin — allow.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.includes(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "traceparent",
      "tracestate",
      "newrelic",
    ],
  });
  await app.register(cookie);

  // Custom error handler - see lib/error-handler.ts for the rationale
  // (4xx vs 5xx log levels, NR alarm hygiene, { error } body shape).
  app.setErrorHandler(errorHandler);

  // Register all feature routes
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(memberRoutes, { prefix: "/api" });
  await app.register(chargeRoutes, { prefix: "/api" });
  await app.register(juniorRoutes, { prefix: "/api" });
  await app.register(membershipRoutes, { prefix: "/api" });
  await app.register(fantasyRoutes, { prefix: "/api" });
  await app.register(gamesRoutes, { prefix: "/api" });
  await app.register(playCricketRoutes, { prefix: "/api" });
  await app.register(sponsorshipRoutes, { prefix: "/api" });
  await app.register(matchdayRoutes, { prefix: "/api" });
  await app.register(availabilityRoutes, { prefix: "/api" });
  await app.register(paymentRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api" });
  await app.register(documentRoutes, { prefix: "/api" });
  await app.register(treasurerRoutes, { prefix: "/api" });
  await app.register(leaderboardRoutes, { prefix: "/api" });
  await app.register(cricketLeaderboardRoutes, { prefix: "/api" });
  await app.register(recordsRoutes, { prefix: "/api" });
  await app.register(scoutRoutes, { prefix: "/api" });
  await app.register(contactRoutes, { prefix: "/api" });
  await app.register(incidentReportRoutes, { prefix: "/api" });
  await app.register(financialReliefRoutes, { prefix: "/api" });
  await app.register(userGroupsRoutes, { prefix: "/api" });
  await app.register(marketingRoutes, { prefix: "/api" });
  await app.register(notifPrefsRoutes, { prefix: "/api" });
  await app.register(pushSubscriptionRoutes, { prefix: "/api" });
  await app.register(webhookRoutes, { prefix: "/api" });
  await app.register(ogImageRoutes, { prefix: "/api" });
  await app.register(contentRoutes, { prefix: "/api" });
  await app.register(contentImageRoutes, { prefix: "/api" });
  await app.register(contentAuthorRoutes, { prefix: "/api" });
  await app.register(contentProposalRoutes, { prefix: "/api" });

  // Marketing forwarder: periodic drain of marketing_outbox -> Google Ads.
  // No-op when GOOGLE_ADS_* env vars are absent.
  const adsClient = createAdsClient(config);
  const forwarder = startForwarder({
    db,
    client: adsClient,
    log: app.log,
  });
  app.addHook("onClose", () => {
    forwarder.stop();
  });

  return app;
}
