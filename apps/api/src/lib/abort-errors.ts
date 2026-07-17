/**
 * Detects aborted-operation errors (DOMException or Error with
 * name "AbortError") that libraries leak as floating-promise
 * rejections when an in-flight operation is cancelled - e.g.
 * better-auth's dash plugin when a client disconnects mid-request.
 *
 * These are request-scoped, not process-corrupting, so the
 * process-level unhandledRejection handler logs them and keeps
 * serving instead of exiting (2026-07-17: one aborted dash request
 * crashed the API task and took prod down for ~40s).
 */
export function isAbortError(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    reason.name === "AbortError"
  );
}
