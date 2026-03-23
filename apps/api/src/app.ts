import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { DB } from "@percy-main/db";
import { createSend, type Email } from "@percy-main/email";
import Fastify from "fastify";
import type { Kysely, PostgresDialect } from "kysely";
import type { Config } from "./config.ts";
import { createAuth, type Auth } from "./features/auth/auth.ts";
import { createS3Uploader, type S3Uploader } from "./lib/s3-upload.ts";

// Feature routes
import { adminRoutes } from "./features/admin/routes.ts";
import { authRoutes } from "./features/auth/routes.ts";
import { availabilityRoutes } from "./features/availability/routes.ts";
import { chargeRoutes } from "./features/charges/routes.ts";
import { contactRoutes } from "./features/contact/routes.ts";
import { cricketLeaderboardRoutes } from "./features/cricket-leaderboard/routes.ts";
import { fantasyRoutes } from "./features/fantasy/routes.ts";
import { gamesRoutes } from "./features/games/routes.ts";
import { healthRoutes } from "./features/health/routes.ts";
import { juniorRoutes } from "./features/junior/routes.ts";
import { leaderboardRoutes } from "./features/leaderboard/routes.ts";
import { matchdayRoutes } from "./features/matchday/routes.ts";
import { memberRoutes } from "./features/members/routes.ts";
import { ogImageRoutes } from "./features/og-image/routes.ts";
import { paymentRoutes } from "./features/payments/routes.ts";
import { webhookRoutes } from "./features/payments/webhook.ts";
import { playCricketRoutes } from "./features/play-cricket/routes.ts";
import { sponsorshipRoutes } from "./features/sponsorship/routes.ts";
import { treasurerRoutes } from "./features/treasurer/routes.ts";

// Extend Fastify types with our decorations
declare module "fastify" {
  interface FastifyInstance {
    db: Kysely<DB>;
    config: Config;
    auth: Auth;
    send: (email: Email) => Promise<void>;
    s3: S3Uploader | null;
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

  // Create and decorate the S3 uploader (null if S3 not configured)
  const s3 = createS3Uploader(config);
  app.decorate("s3", s3);

  // Plugins
  await app.register(cors, {
    origin: config.BASE_URL,
    credentials: true,
  });
  await app.register(cookie);

  // Register all feature routes
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(memberRoutes, { prefix: "/api" });
  await app.register(chargeRoutes, { prefix: "/api" });
  await app.register(juniorRoutes, { prefix: "/api" });
  await app.register(fantasyRoutes, { prefix: "/api" });
  await app.register(gamesRoutes, { prefix: "/api" });
  await app.register(playCricketRoutes, { prefix: "/api" });
  await app.register(sponsorshipRoutes, { prefix: "/api" });
  await app.register(matchdayRoutes, { prefix: "/api" });
  await app.register(availabilityRoutes, { prefix: "/api" });
  await app.register(paymentRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api" });
  await app.register(treasurerRoutes, { prefix: "/api" });
  await app.register(leaderboardRoutes, { prefix: "/api" });
  await app.register(cricketLeaderboardRoutes, { prefix: "/api" });
  await app.register(contactRoutes, { prefix: "/api" });
  await app.register(webhookRoutes, { prefix: "/api" });
  await app.register(ogImageRoutes, { prefix: "/api" });

  return app;
}
