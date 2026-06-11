import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/**
 * Custom error handler. Reasons over Fastify's default:
 *  - Stops 4xx (deliberately thrown via Object.assign(new Error,
 *    { statusCode: 4xx })) from polluting NR's error-rate alarm.
 *    400/401/403/404 log at warn with kind=http_client_error.
 *  - 5xx and unknown statuses log at error with kind=http_error.
 *  - Pino redact (#171) handles PII in the err object; the handler
 *    doesn't need to re-redact.
 *  - Reply body keeps the existing { error: message } shape so clients
 *    aren't broken.
 *
 * Exported standalone so integration tests can register the SAME
 * handler on their minimal apps - error-body assertions (e.g. the
 * by-path 410 tombstone) then exercise the production contract.
 */
export function errorHandler(
  err: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const status = err.statusCode ?? 500;
  if (status >= 500) {
    request.log.error(
      { err, event: "http_error", status },
      err.message || "internal_server_error",
    );
  } else {
    request.log.warn({ err, event: "http_client_error", status }, err.message);
  }
  return reply.status(status).send({ error: err.message });
}
