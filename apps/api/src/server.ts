import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { membershipRoutes } from "./routes/membership.js";
import { chargeRoutes } from "./routes/charges.js";
import { webhookRoutes } from "./routes/webhooks.js";

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

// Routes
await app.register(healthRoutes);
await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(membershipRoutes, { prefix: "/api" });
await app.register(chargeRoutes, { prefix: "/api" });
await app.register(webhookRoutes, { prefix: "/api" });

// Start
const port = parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
