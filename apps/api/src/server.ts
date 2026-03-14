import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

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

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
  },
});

// Plugins
await app.register(cors, {
  origin: process.env.BASE_URL ?? "http://localhost:5173",
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

// Start
const port = parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
