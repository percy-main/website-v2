/**
 * OpenTelemetry instrumentation for New Relic.
 *
 * This file must be loaded before any other application code via the
 * `--import` flag so that auto-instrumentations can patch modules
 * (HTTP, Fastify, Pino, pg) before they are first imported.
 *
 * When NEW_RELIC_LICENSE_KEY is not set (e.g. local dev), the SDK is
 * not started and the application runs without telemetry overhead.
 */

// Reading process.env directly here because this file runs via --import
// before the app starts — app.config does not exist yet.
const licenseKey = process.env.NEW_RELIC_LICENSE_KEY;

if (licenseKey) {
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } =
    await import("@opentelemetry/auto-instrumentations-node");
  const { OTLPTraceExporter } =
    await import("@opentelemetry/exporter-trace-otlp-proto");
  const { OTLPMetricExporter } =
    await import("@opentelemetry/exporter-metrics-otlp-proto");
  const { OTLPLogExporter } =
    await import("@opentelemetry/exporter-logs-otlp-proto");
  const { PeriodicExportingMetricReader } =
    await import("@opentelemetry/sdk-metrics");
  const { BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME } =
    await import("@opentelemetry/semantic-conventions");
  const { FastifyOtelInstrumentation } = await import("@fastify/otel");

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "https://otlp.eu01.nr-data.net";
  const serviceName = process.env.OTEL_SERVICE_NAME ?? "percy-main-api";
  const environment = process.env.NODE_ENV ?? "development";

  const headers = { "api-key": licenseKey };

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    "deployment.environment.name": environment,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
        headers,
      }),
      exportIntervalMillis: 30_000,
    }),
    logRecordProcessor: new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
        headers,
      }),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Only instrument fs when it's part of another trace to reduce noise
        "@opentelemetry/instrumentation-fs": {
          requireParentSpan: true,
        },
      }),
      // Fastify-specific instrumentation for route-level spans and middleware timing
      // (not included in the auto-instrumentations meta-package).
      // registerOnInitialization auto-registers the plugin against Fastify
      // instances at construction time, mirroring the old patch-on-import behaviour.
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown — flush pending telemetry before process exits
  const shutdown = async () => {
    await sdk.shutdown();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}
