import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  healthLiveResponseSchema,
  healthReadyResponseSchema,
  healthResponseSchema,
} from "./schemas.ts";

/**
 * Three endpoints to keep the deploy story sane:
 *
 * - /health/live: liveness only. No deps. Used by orchestrators that
 *   should restart the process if the event loop is wedged. Returning
 *   200 here when the DB is down is correct — restarting the API task
 *   on a DB outage just thrashes traffic.
 *
 * - /health/ready: readiness. Pings the DB. Returns 503 on failure so
 *   ALB target groups (and any other readiness probe) drain the
 *   instance instead of treating it as healthy. The ALB target group
 *   in infra/modules/ecs-service.tf points here.
 *
 *   Caveat for production: task_count = 1 means there's only ever one
 *   target. ALB fails open ("if all targets are unhealthy, route to
 *   them all anyway") so 503 doesn't actually drain the box — it just
 *   trips the unhealthy alarm so on-call notices. Real shed-traffic
 *   would need either >1 task or a Lambda@Edge maintenance page. The
 *   503 is still useful as a signal to NR alarms / R53 health checks.
 *
 * - /health: legacy shape kept for any external probes still wired to
 *   the old endpoint. Always 200, body field reports degraded state.
 *   Don't add new consumers; migrate them to /health/live or
 *   /health/ready.
 */

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health/live",
    {
      schema: {
        response: { 200: healthLiveResponseSchema },
      },
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- Fastify route handler signature
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/health/ready",
    {
      schema: {
        response: {
          200: healthReadyResponseSchema,
          503: healthReadyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await app.db.selectFrom("user").select("id").limit(1).execute();
        return {
          status: "ok" as const,
          database: "connected" as const,
        };
      } catch (err) {
        request.log.warn({ err }, "health_ready_db_disconnected");
        return reply.status(503).send({
          status: "unhealthy" as const,
          database: "disconnected" as const,
        });
      }
    },
  );

  app.get(
    "/health",
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async (request) => {
      try {
        await app.db.selectFrom("user").select("id").limit(1).execute();
        return { status: "ok" as const, database: "connected" as const };
      } catch (err) {
        request.log.warn({ err }, "health_legacy_db_disconnected");
        return {
          status: "degraded" as const,
          database: "disconnected" as const,
        };
      }
    },
  );
};
