/**
 * Helper for threading the Phoenix tracer into AI SDK calls so LLM spans
 * land in the isolated Phoenix tracer provider rather than the global
 * (New Relic) one.
 *
 * AI SDK 7 removed `experimental_telemetry.tracer`; per-call telemetry now
 * flows through Telemetry integrations. LegacyOpenTelemetry emits the v6
 * span format (ai.* attributes) that @arizeai/openinference-vercel's span
 * processor understands, so Phoenix keeps working unchanged. v7 also
 * dropped the per-call `metadata` option, so the tracer is wrapped to stamp
 * `ai.telemetry.metadata.*` attributes onto every span - the exact v6
 * attribute names Phoenix maps to session/user/custom metadata.
 */
import { LegacyOpenTelemetry } from "@ai-sdk/otel";
import type { Context, Span, SpanOptions, Tracer } from "@opentelemetry/api";
import type { TelemetryOptions } from "ai";

function withMetadataAttributes(
  tracer: Tracer,
  metadata: Record<string, string>,
): Tracer {
  const extra = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      `ai.telemetry.metadata.${key}`,
      value,
    ]),
  );
  const merge = (options?: SpanOptions): SpanOptions => ({
    ...options,
    attributes: { ...extra, ...options?.attributes },
  });
  return {
    startSpan: (name, options, ctx) =>
      ctx === undefined
        ? tracer.startSpan(name, merge(options))
        : tracer.startSpan(name, merge(options), ctx),
    startActiveSpan: (
      name: string,
      ...rest:
        | [fn: (span: Span) => unknown]
        | [options: SpanOptions, fn: (span: Span) => unknown]
        | [options: SpanOptions, ctx: Context, fn: (span: Span) => unknown]
    ) => {
      if (rest.length === 1) {
        return tracer.startActiveSpan(name, merge(), rest[0]);
      }
      if (rest.length === 2) {
        return tracer.startActiveSpan(name, merge(rest[0]), rest[1]);
      }
      return tracer.startActiveSpan(name, merge(rest[0]), rest[1], rest[2]);
    },
  };
}

export function buildPhoenixTelemetry(
  tracer: Tracer,
  functionId: string,
  metadata?: Record<string, string>,
): TelemetryOptions {
  return {
    isEnabled: true,
    functionId,
    integrations: [
      new LegacyOpenTelemetry({
        tracer: metadata ? withMetadataAttributes(tracer, metadata) : tracer,
      }),
    ],
  };
}
