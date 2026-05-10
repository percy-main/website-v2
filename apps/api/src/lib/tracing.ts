/**
 * Thin wrapper around OTel's tracer.startActiveSpan that:
 *
 * - Records the wrapped function's thrown error on the span and sets
 *   the span status to ERROR before re-throwing — without this, an
 *   exception leaves the span in OK state.
 * - Always ends the span (even if the function throws) so spans
 *   don't leak.
 * - Returns the wrapped function's return value untouched.
 *
 * Use for high-value flows (#186) where the auto-instrumentation
 * doesn't give a useful breakdown — e.g., a multi-step file upload
 * where mint, S3 PUT, commit, derive each take meaningful time but
 * collapse into one Fastify span otherwise.
 */
import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

const tracer = trace.getTracer("percy-main-api");

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
