import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";

/**
 * Creates a fresh Fastify app instance for testing.
 * Each test file gets its own isolated app.
 */
export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);

  // Register all feature routes
  const { healthRoutes } = await import("../features/health/routes.js");
  const { authRoutes } = await import("../features/auth/routes.js");
  const { memberRoutes } = await import("../features/members/routes.js");
  const { chargeRoutes } = await import("../features/charges/routes.js");
  const { juniorRoutes } = await import("../features/junior/routes.js");
  const { fantasyRoutes } = await import("../features/fantasy/routes.js");
  const { playCricketRoutes } = await import(
    "../features/play-cricket/routes.js"
  );
  const { sponsorshipRoutes } = await import(
    "../features/sponsorship/routes.js"
  );
  const { matchdayRoutes } = await import("../features/matchday/routes.js");
  const { paymentRoutes } = await import("../features/payments/routes.js");
  const { adminRoutes } = await import("../features/admin/routes.js");
  const { treasurerRoutes } = await import("../features/treasurer/routes.js");
  const { leaderboardRoutes } = await import(
    "../features/leaderboard/routes.js"
  );
  const { contactRoutes } = await import("../features/contact/routes.js");

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
