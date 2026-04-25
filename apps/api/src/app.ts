import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { DB } from "@percy-main/db";
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
import {
  createS3DocumentStore,
  type S3DocumentStore,
} from "./lib/s3-documents.ts";
import { createS3Uploader, type S3Uploader } from "./lib/s3-upload.ts";

// Feature routes
import { adminRoutes } from "./features/admin/routes.ts";
import { authRoutes } from "./features/auth/routes.ts";
import { availabilityRoutes } from "./features/availability/routes.ts";
import { chargeRoutes } from "./features/charges/routes.ts";
import { contactRoutes } from "./features/contact/routes.ts";
import { cricketLeaderboardRoutes } from "./features/cricket-leaderboard/routes.ts";
import { documentRoutes } from "./features/documents/routes.ts";
import { fantasyRoutes } from "./features/fantasy/routes.ts";
import { gamesRoutes } from "./features/games/routes.ts";
import { healthRoutes } from "./features/health/routes.ts";
import { incidentReportRoutes } from "./features/incident-report/routes.ts";
import { juniorRoutes } from "./features/junior/routes.ts";
import { leaderboardRoutes } from "./features/leaderboard/routes.ts";
import { marketingRoutes } from "./features/marketing/routes.ts";
import { matchdayRoutes } from "./features/matchday/routes.ts";
import { memberRoutes } from "./features/members/routes.ts";
import { membershipRoutes } from "./features/membership/routes.ts";
import { ogImageRoutes } from "./features/og-image/routes.ts";
import { paymentRoutes } from "./features/payments/routes.ts";
import { webhookRoutes } from "./features/payments/webhook.ts";
import { playCricketRoutes } from "./features/play-cricket/routes.ts";
import { recordsRoutes } from "./features/records/routes.ts";
import { sponsorshipRoutes } from "./features/sponsorship/routes.ts";
import { treasurerRoutes } from "./features/treasurer/routes.ts";

// Extend Fastify types with our decorations
declare module "fastify" {
  interface FastifyInstance {
    db: Kysely<DB>;
    config: Config;
    auth: Auth;
    send: (email: Email) => Promise<void>;
    s3: S3Uploader;
    s3Documents: S3DocumentStore;
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

  // Create and decorate the email sender
  const send = createSend({
    provider: config.EMAIL_PROVIDER,
    sesRegion: config.SES_REGION,
    fromAddress: config.SES_FROM_ADDRESS,
  });
  app.decorate("send", send);

  // Create and decorate the auth instance
  const auth = createAuth(config, dialect, send);
  app.decorate("auth", auth);

  // Create and decorate the S3 uploader (receipt images)
  const s3 = createS3Uploader(config);
  app.decorate("s3", s3);

  // Create and decorate the S3 document store (policy documents)
  const s3Documents = createS3DocumentStore(config);
  app.decorate("s3Documents", s3Documents);

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

  await app.register(cors, {
    origin: config.BASE_URL,
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
  await app.register(contactRoutes, { prefix: "/api" });
  await app.register(incidentReportRoutes, { prefix: "/api" });
  await app.register(marketingRoutes, { prefix: "/api" });
  await app.register(webhookRoutes, { prefix: "/api" });
  await app.register(ogImageRoutes, { prefix: "/api" });

  return app;
}
