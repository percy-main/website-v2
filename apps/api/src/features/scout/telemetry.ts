/**
 * Helper for threading the Phoenix tracer into AI SDK calls so LLM spans
 * land in the isolated Phoenix tracer provider rather than the global
 * (New Relic) one.
 */
import type { Tracer } from "@opentelemetry/api";
import type { TelemetrySettings } from "ai";

export function buildPhoenixTelemetry(
  tracer: Tracer,
  functionId: string,
  metadata?: Record<string, string>,
): TelemetrySettings {
  return {
    isEnabled: true,
    tracer,
    functionId,
    ...(metadata ? { metadata } : {}),
  };
}
