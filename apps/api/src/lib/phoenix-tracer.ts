/**
 * Standalone Arize Phoenix tracer for Vercel AI SDK spans.
 *
 * Creates an isolated NodeTracerProvider that is NOT registered globally -
 * the New Relic OTel pipeline in instrumentation.ts owns the global tracer
 * provider. We pass this tracer into AI SDK calls via
 * experimental_telemetry.tracer so LLM spans flow exclusively to Phoenix
 * while HTTP / pg / Fastify spans continue to New Relic.
 */
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import {
  isOpenInferenceSpan,
  OpenInferenceBatchSpanProcessor,
} from "@arizeai/openinference-vercel";
import { context, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Config } from "../config.ts";

export interface PhoenixTracer {
  tracer: Tracer;
  shutdown: () => Promise<void>;
}

export function createPhoenixTracer(config: Config): PhoenixTracer {
  // Without a global ContextManager, OTel's active context is permanently
  // ROOT_CONTEXT, so every span the AI SDK opens via
  // tracer.startActiveSpan(...) becomes a new root - a new trace per
  // streamText / generateText, with no nesting under the parent turn span.
  // NR's NodeSDK installs one when NEW_RELIC_LICENSE_KEY is set; this
  // ensures one is installed regardless (no-op if NR already did it -
  // setGlobalContextManager returns false rather than overriding).
  const cm = new AsyncLocalStorageContextManager();
  cm.enable();
  context.setGlobalContextManager(cm);

  // Phoenix Cloud's copy-paste UI hands out the bare space URL
  // (https://app.phoenix.arize.com/s/<space>) without the OTLP path,
  // but the actual collector endpoint is that URL + /v1/traces. Accept
  // both forms (with or without the trailing OTLP path) so a future
  // env update can paste either verbatim.
  const base = config.PHOENIX_COLLECTOR_ENDPOINT.replace(/\/+$/, "").replace(
    /\/v1\/traces$/,
    "",
  );
  const otlpUrl = `${base}/v1/traces`;

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.PHOENIX_PROJECT_NAME,
      [SEMRESATTRS_PROJECT_NAME]: config.PHOENIX_PROJECT_NAME,
    }),
    spanProcessors: [
      new OpenInferenceBatchSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: otlpUrl,
          headers: {
            // Phoenix Cloud accepts the API key under both header names;
            // self-hosted instances may differ. Sending both is harmless
            // and lets a single config work against either backend.
            api_key: config.PHOENIX_API_KEY,
            Authorization: `Bearer ${config.PHOENIX_API_KEY}`,
          },
        }),
        // Drops any non-AI-SDK span that happens to be started against this
        // provider so Phoenix only sees generative traces.
        spanFilter: isOpenInferenceSpan,
      }),
    ],
  });

  return {
    tracer: provider.getTracer("@arizeai/openinference-vercel"),
    shutdown: () => provider.shutdown(),
  };
}
