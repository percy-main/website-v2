import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import { buildPhoenixTelemetry } from "./telemetry.ts";

function makeTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return { tracer: provider.getTracer("test"), exporter };
}

const mockModel = () =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: "hello" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
        raw: undefined,
      },
      warnings: [],
    },
  });

describe("buildPhoenixTelemetry", () => {
  it("emits legacy-format spans to the provided tracer", async () => {
    const { tracer, exporter } = makeTracer();

    await generateText({
      model: mockModel(),
      prompt: "hi",
      telemetry: buildPhoenixTelemetry(tracer, "test.fn"),
    });

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const root = spans.find((s) => s.name === "ai.generateText");
    expect(root).toBeDefined();
    expect(root?.attributes["ai.telemetry.functionId"]).toBe("test.fn");
    expect(root?.attributes["operation.name"]).toBe(
      "ai.generateText test.fn",
    );
  });

  it("stamps ai.telemetry.metadata.* attributes onto every span", async () => {
    const { tracer, exporter } = makeTracer();

    await generateText({
      model: mockModel(),
      prompt: "hi",
      telemetry: buildPhoenixTelemetry(tracer, "test.fn", {
        "session.id": "thread-1",
        "user.id": "user-1",
      }),
    });

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.attributes["ai.telemetry.metadata.session.id"]).toBe(
        "thread-1",
      );
      expect(span.attributes["ai.telemetry.metadata.user.id"]).toBe("user-1");
    }
  });
});
