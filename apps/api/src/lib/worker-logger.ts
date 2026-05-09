/**
 * Pino-backed FastifyBaseLogger for standalone worker processes
 * (scout-knowledge-worker, scout-report-worker, migrate). The workers
 * don't need an HTTP server but several call paths now require a
 * non-optional `logger: FastifyBaseLogger`. Booting a Fastify instance
 * just to get its logger gives us the same Pino shape the API code
 * uses, with no extra dependency.
 */

import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";

export function createWorkerLogger(name: string): FastifyBaseLogger {
  // `genReqId` is required by the type but never called outside the
  // request lifecycle — workers don't have requests.
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      base: { name },
    },
  });
  return app.log;
}

/**
 * Silent logger for unit tests. Satisfies FastifyBaseLogger without
 * emitting anything (or booting Fastify). Use in test fixtures that
 * need to satisfy a non-optional `logger` dep.
 */
export function createNoopLogger(): FastifyBaseLogger {
  const noop = () => {};
  const logger = {
    level: "silent" as const,
    silent: noop,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger as unknown as FastifyBaseLogger;
}
