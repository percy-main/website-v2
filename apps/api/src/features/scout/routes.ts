import {
  convertToModelMessages,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getAuthSession } from "../auth/middleware.ts";
import { createApiClient } from "../play-cricket/api-client.ts";
import { createScoutAgent } from "./agent.ts";
import { requireScoutAccess } from "./auth.ts";
import {
  accessResponseSchema,
  createThreadBodySchema,
  createThreadResponseSchema,
  deleteThreadResponseSchema,
  getThreadResponseSchema,
  listThreadsResponseSchema,
  threadIdParamSchema,
} from "./schemas.ts";
import {
  appendMessage,
  assertThreadOwnership,
  bumpThreadUpdatedAt,
  createThread,
  deleteThread,
  getThread,
  listThreads,
  ThreadNotFoundError,
} from "./service.ts";
import { maybeGenerateTitle } from "./title.ts";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const scoutRoutes: FastifyPluginAsyncZod = async (app) => {
  const list = listThreads(app.db);
  const create = createThread(app.db);
  const get = getThread(app.db);
  const remove = deleteThread(app.db);
  const append = appendMessage(app.db);
  const bump = bumpThreadUpdatedAt(app.db);
  const assertOwned = assertThreadOwnership(app.db);
  const generateTitle = maybeGenerateTitle({
    db: app.db,
    modelId: app.config.SCOUT_MODEL_SUBAGENT,
  });

  // ── Access probe ──
  // Always 200 so the FE can call this without a noisy 401 when nobody is
  // logged in — `{ allowed: false }` means "hide the link", regardless of
  // whether the visitor is anonymous or authed-but-not-allowlisted.
  app.get(
    "/scout/access",
    {
      schema: {
        response: { 200: accessResponseSchema },
      },
    },
    async (request) => {
      const session = await request.server.auth.api.getSession({
        headers: toWebHeaders(request.headers),
      });
      if (!session) {
        return { allowed: false, email: null };
      }
      const email = session.user.email;
      const allowed = app.config.SCOUT_ALLOWED_EMAILS.includes(email);
      return { allowed, email };
    },
  );

  // ── Thread CRUD ──

  app.get(
    "/scout/threads",
    {
      preHandler: [requireScoutAccess],
      schema: {
        response: { 200: listThreadsResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return { threads: await list(user.id) };
    },
  );

  app.post(
    "/scout/threads",
    {
      preHandler: [requireScoutAccess],
      schema: {
        body: createThreadBodySchema,
        response: { 200: createThreadResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      return await create(user.id, request.body.title);
    },
  );

  app.get(
    "/scout/threads/:threadId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: threadIdParamSchema,
        response: { 200: getThreadResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      try {
        return await get(user.id, request.params.threadId);
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw Object.assign(new Error("Thread not found"), {
            statusCode: 404,
          });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/scout/threads/:threadId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: threadIdParamSchema,
        response: { 200: deleteThreadResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      try {
        await remove(user.id, request.params.threadId);
        return { ok: true as const };
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw Object.assign(new Error("Thread not found"), {
            statusCode: 404,
          });
        }
        throw err;
      }
    },
  );

  // ── Streaming chat ──
  // Hidden from OpenAPI: SSE doesn't model in OpenAPI, and the frontend uses
  // useChat from @ai-sdk/react which speaks the AI SDK UIMessageStream wire
  // format directly — no typed client needed.
  app.post(
    "/scout/threads/:threadId/messages",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: threadIdParamSchema,
        hide: true,
      },
    },
    async (request, reply) => {
      const { user } = getAuthSession(request);
      const { threadId } = request.params;

      // Guard: Scout requires the readonly DB client and an Anthropic key.
      // Both are optional in config so non-Scout deployments can boot, but
      // hitting this route without them is a misconfiguration.
      const dbReadonly = app.dbReadonly;
      if (!dbReadonly) {
        throw Object.assign(
          new Error("Scout DB is not configured (set SCOUT_DB_URL)."),
          { statusCode: 503 },
        );
      }
      if (!app.config.ANTHROPIC_API_KEY) {
        throw Object.assign(new Error("ANTHROPIC_API_KEY is not configured."), {
          statusCode: 503,
        });
      }
      if (
        !app.config.PLAY_CRICKET_API_TOKEN ||
        !app.config.PLAY_CRICKET_SITE_ID
      ) {
        throw Object.assign(new Error("Play Cricket API is not configured."), {
          statusCode: 503,
        });
      }

      try {
        await assertOwned(user.id, threadId);
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw Object.assign(new Error("Thread not found"), {
            statusCode: 404,
          });
        }
        throw err;
      }

      const body = request.body as { messages?: UIMessage[] } | undefined;
      const incoming = body?.messages;
      if (!Array.isArray(incoming) || incoming.length === 0) {
        throw Object.assign(new Error("messages array is required"), {
          statusCode: 400,
        });
      }

      const lastMessage = incoming[incoming.length - 1];
      if (lastMessage.role !== "user") {
        throw Object.assign(new Error("Last message must be from the user."), {
          statusCode: 400,
        });
      }

      // Persist the new user message before the model runs — if streaming
      // fails we still want a record of what was asked.
      await append(threadId, "user", lastMessage.parts);

      const playCricket = createApiClient({
        apiToken: app.config.PLAY_CRICKET_API_TOKEN,
        siteId: app.config.PLAY_CRICKET_SITE_ID,
      });

      const firstUserText = lastMessage.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");

      // Convert messages up front — execute() in createUIMessageStream is
      // synchronous and can't await, so the conversion has to be done before
      // the stream is built.
      const modelMessages = await convertToModelMessages(incoming);

      // Token usage is captured inside execute() and read back in onFinish.
      // We can't await result.usage from outside because `result` is local to
      // the stream's execute closure.
      let usagePromise:
        | Promise<{
            inputTokens?: number;
            outputTokens?: number;
          }>
        | undefined;

      const stream = createUIMessageStream({
        originalMessages: incoming,
        onFinish: async ({ responseMessage, isAborted }) => {
          if (isAborted || !responseMessage) return;
          try {
            const usage = (await usagePromise) ?? {};
            await append(threadId, "assistant", responseMessage.parts, {
              input: usage.inputTokens,
              output: usage.outputTokens,
            });
            await bump(threadId);
            // Best-effort: rename the thread if it still has the
            // placeholder title. Failures don't break the chat turn.
            await generateTitle(threadId, firstUserText);
          } catch (err) {
            app.log.error(
              { err, threadId },
              "scout: failed to persist assistant message",
            );
          }
        },
        execute: ({ writer }) => {
          // The chart tool needs the writer to emit data-chart parts inline.
          const agent = createScoutAgent({
            db: app.db,
            dbReadonly,
            playCricket,
            config: app.config,
            writer,
          });

          const result = streamText({
            model: agent.model,
            system: agent.system,
            tools: agent.tools,
            messages: modelMessages,
            stopWhen: stepCountIs(agent.maxSteps),
            onError: ({ error }) => {
              app.log.error(
                { err: sanitizeError(error) },
                "scout streamText error",
              );
            },
          });
          usagePromise = Promise.resolve(result.usage).then((u) => ({
            inputTokens: u.inputTokens ?? undefined,
            outputTokens: u.outputTokens ?? undefined,
          }));

          // sendStart: false because createUIMessageStream emits its own start
          // chunk; merging streamText's would duplicate.
          writer.merge(result.toUIMessageStream({ sendStart: false }));
        },
        onError: (error) => {
          app.log.error({ err: sanitizeError(error) }, "scout UI stream error");
          return error instanceof Error
            ? error.message
            : "Scout stream failed.";
        },
      });

      // CORS (and any other) headers set by Fastify hooks live on the reply
      // object and are flushed to `reply.raw` only when reply.send() runs.
      // pipeUIMessageStreamToResponse writes directly to `reply.raw` via
      // writeHead(), so we must copy those headers onto raw first — otherwise
      // the streamed response goes out without Access-Control-Allow-Origin and
      // the browser blocks it.
      for (const [key, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined && !reply.raw.hasHeader(key)) {
          reply.raw.setHeader(key, value);
        }
      }

      pipeUIMessageStreamToResponse({ stream, response: reply.raw });

      // Return the raw reply so Fastify doesn't double-write a body.
      return reply;
    },
  );
};

// AI SDK errors (most importantly Anthropic's APICallError) carry the entire
// request body — including the conversation history — as own properties.
// Logging the raw error via pino spams the stream with full transcripts, so
// project to a small set of safe fields. The Anthropic request_id is the most
// useful debug handle when it's present.
function sanitizeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { value: typeof error === "string" ? error : String(error) };
  }
  const e = error as Error & {
    statusCode?: number;
    responseBody?: string;
    requestId?: string;
    data?: { error?: { type?: string; message?: string } };
  };
  return {
    name: e.name,
    message: e.message,
    statusCode: e.statusCode,
    requestId: e.requestId,
    apiError: e.data?.error,
  };
}

// Small inline helper — same shape as the one in auth/middleware.ts but the
// access route can't use requireAuth (we want a 200 response when not
// allowed, not 401, so the FE can hide the link without a noisy console
// 401).
function toWebHeaders(headers: Record<string, unknown>): Headers {
  const webHeaders = new Headers();
  const stringify = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    return null; // skip arrays-of-non-strings, objects, booleans, etc.
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value as unknown[]) {
        const s = stringify(v);
        if (s !== null) webHeaders.append(key, s);
      }
    } else {
      const s = stringify(value);
      if (s !== null) webHeaders.set(key, s);
    }
  }
  return webHeaders;
}
