import {
  convertToModelMessages,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession, requirePermission } from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import { createVoyageClient } from "../scout/facts/voyage.ts";
import { buildPhoenixTelemetry } from "../scout/telemetry.ts";
import { createContentAuthorAgent } from "./agent.ts";
import { contentAuthorRequestBodySchema } from "./schemas.ts";

/**
 * AI content-author assistant. A single stateless streaming route behind the
 * "Generate with AI" modal over the content editor. Reuses Scout's data tools
 * (Play Cricket, ball-by-ball, database) plus the write_content tool, which
 * streams data-content-blocks parts the modal appends to the live editor.
 *
 * Stateless by design (ephemeral chat): useChat on the client holds the
 * conversation and replays it each turn, so there is no thread persistence.
 * The route is hidden from the OpenAPI spec (SSE / UIMessageStream wire
 * format, consumed by @ai-sdk/react's useChat directly) - same as Scout.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const contentAuthorRoutes: FastifyPluginAsyncZod = async (app) => {
  const aiContent = requirePermission("ai_content", "use");

  app.post(
    "/content-author/messages",
    {
      preHandler: [aiContent],
      schema: {
        body: contentAuthorRequestBodySchema,
        hide: true,
      },
    },
    async (request, reply) => {
      const { user } = getAuthSession(request);

      // Preflight the dependencies the agent needs, failing fast with 503 so
      // the modal shows a clear error before any tokens are spent.
      const dbReadonly = app.dbReadonly;
      if (!dbReadonly) {
        throw Object.assign(
          new Error("Content AI DB is not configured (set SCOUT_DB_URL)."),
          { statusCode: 503 },
        );
      }
      if (
        app.config.CONTENT_AI_PROVIDER === "anthropic" &&
        !app.config.ANTHROPIC_API_KEY
      ) {
        throw Object.assign(
          new Error(
            "ANTHROPIC_API_KEY is not configured but CONTENT_AI_PROVIDER is anthropic.",
          ),
          { statusCode: 503 },
        );
      }
      if (
        app.config.CONTENT_AI_PROVIDER === "deepseek" &&
        !app.config.DEEPSEEK_API_KEY
      ) {
        throw Object.assign(
          new Error(
            "DEEPSEEK_API_KEY is not configured but CONTENT_AI_PROVIDER is deepseek.",
          ),
          { statusCode: 503 },
        );
      }
      if (
        !app.config.PLAY_CRICKET_API_TOKEN ||
        !app.config.PLAY_CRICKET_SITE_ID
      ) {
        throw Object.assign(new Error("Play Cricket API is not configured."), {
          statusCode: 503,
        });
      }

      const incoming = request.body.messages as UIMessage[];
      const { editorContext } = request.body;

      const lastMessage = incoming[incoming.length - 1];
      if (lastMessage.role !== "user") {
        throw Object.assign(new Error("Last message must be from the user."), {
          statusCode: 400,
        });
      }

      const playCricket = createApiClient({
        apiToken: app.config.PLAY_CRICKET_API_TOKEN,
        siteId: app.config.PLAY_CRICKET_SITE_ID,
      });

      // Voyage powers read-only fact retrieval (teams / grounds / players).
      // Optional - without it the agent just runs without fact_retrieve.
      const voyage = app.config.VOYAGE_API_KEY
        ? createVoyageClient({
            apiKey: app.config.VOYAGE_API_KEY,
            embedModel: app.config.VOYAGE_EMBED_MODEL,
            rerankModel: app.config.VOYAGE_RERANK_MODEL,
          })
        : undefined;

      // Convert up front - createUIMessageStream's execute is synchronous.
      const modelMessages = await convertToModelMessages(incoming);

      const stream = createUIMessageStream({
        originalMessages: incoming,
        execute: ({ writer }) => {
          const agent = createContentAuthorAgent({
            db: app.db,
            dbReadonly,
            playCricket,
            config: app.config,
            writer,
            logger: app.log,
            userId: user.id,
            voyage,
            editorContext,
          });

          const result = streamText({
            model: agent.model,
            system: agent.system,
            tools: agent.tools,
            messages: modelMessages,
            stopWhen: stepCountIs(agent.maxSteps),
            maxOutputTokens: agent.maxOutputTokens,
            prepareStep: agent.prepareStep,
            providerOptions: agent.providerOptions,
            experimental_telemetry: buildPhoenixTelemetry(
              app.phoenixTracer,
              "content-author.chat",
              { userId: user.id, kind: editorContext.kind },
            ),
            onError: ({ error }) => {
              request.log.error(
                {
                  err:
                    error instanceof Error
                      ? { name: error.name, message: error.message }
                      : error,
                },
                "content-author streamText error",
              );
            },
          });

          // sendStart: false - createUIMessageStream emits its own start chunk.
          writer.merge(result.toUIMessageStream({ sendStart: false }));
        },
        onError: (error) => {
          // Provider errors can carry account state (billing, rate limits) in
          // the message; log server-side, return a generic string to the UI.
          request.log.error(
            {
              err:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : error,
            },
            "content-author UI stream error",
          );
          return "The assistant failed to respond. Please try again.";
        },
      });

      // CORS (and other) headers set by Fastify hooks only flush to reply.raw
      // on reply.send(); pipeUIMessageStreamToResponse writes to reply.raw via
      // writeHead(), so copy them over first or the browser blocks the stream.
      for (const [key, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined && !reply.raw.hasHeader(key)) {
          reply.raw.setHeader(key, value);
        }
      }

      pipeUIMessageStreamToResponse({ stream, response: reply.raw });

      return reply;
    },
  );
};
