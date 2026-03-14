import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import type { Kysely, PostgresDialect } from "kysely";
import type { DB } from "@percy-main/db";
import type { Config } from "./config.js";
import { createAuth, type Auth } from "./features/auth/auth.js";

// Feature routes
import { healthRoutes } from "./features/health/routes.js";
import { authRoutes } from "./features/auth/routes.js";
import { memberRoutes } from "./features/members/routes.js";
import { chargeRoutes } from "./features/charges/routes.js";
import { juniorRoutes } from "./features/junior/routes.js";
import { fantasyRoutes } from "./features/fantasy/routes.js";
import { playCricketRoutes } from "./features/play-cricket/routes.js";
import { sponsorshipRoutes } from "./features/sponsorship/routes.js";
import { matchdayRoutes } from "./features/matchday/routes.js";
import { paymentRoutes } from "./features/payments/routes.js";
import { adminRoutes } from "./features/admin/routes.js";
import { treasurerRoutes } from "./features/treasurer/routes.js";
import { leaderboardRoutes } from "./features/leaderboard/routes.js";
import { contactRoutes } from "./features/contact/routes.js";

// Extend Fastify types with our decorations
declare module "fastify" {
  interface FastifyInstance {
    db: Kysely<DB>;
    config: Config;
    auth: Auth;
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

  // Create and decorate the auth instance
  const auth = createAuth(config, dialect);
  app.decorate("auth", auth);

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
  await app.register(playCricketRoutes, { prefix: "/api" });
  await app.register(sponsorshipRoutes, { prefix: "/api" });
  await app.register(matchdayRoutes, { prefix: "/api" });
  await app.register(paymentRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api" });
  await app.register(treasurerRoutes, { prefix: "/api" });
  await app.register(leaderboardRoutes, { prefix: "/api" });
  await app.register(contactRoutes, { prefix: "/api" });

  return app;
}
