import {
  convertToModelMessages,
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

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async
export const scoutRoutes: FastifyPluginAsyncZod = async (app) => {
  const list = listThreads(app.db);
  const create = createThread(app.db);
  const get = getThread(app.db);
  const remove = deleteThread(app.db);
  const append = appendMessage(app.db);
  const bump = bumpThreadUpdatedAt(app.db);
  const assertOwned = assertThreadOwnership(app.db);

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
      if (!app.dbReadonly) {
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

      const agent = createScoutAgent({
        db: app.db,
        dbReadonly: app.dbReadonly,
        playCricket,
        config: app.config,
      });

      const modelMessages = await convertToModelMessages(incoming);
      const result = streamText({
        model: agent.model,
        system: agent.system,
        tools: agent.tools,
        messages: modelMessages,
        stopWhen: stepCountIs(agent.maxSteps),
        onError: ({ error }) => {
          app.log.error({ err: error }, "scout streamText error");
        },
      });

      result.pipeUIMessageStreamToResponse(reply.raw, {
        originalMessages: incoming,
        onFinish: async ({ responseMessage, isAborted }) => {
          if (isAborted || !responseMessage) return;
          try {
            const usage = await result.usage;
            await append(threadId, "assistant", responseMessage.parts, {
              input: usage.inputTokens ?? undefined,
              output: usage.outputTokens ?? undefined,
            });
            await bump(threadId);
          } catch (err) {
            app.log.error(
              { err, threadId },
              "scout: failed to persist assistant message",
            );
          }
        },
        onError: (error) => {
          app.log.error({ err: error }, "scout UI stream error");
          return error instanceof Error
            ? error.message
            : "Scout stream failed.";
        },
      });

      // Return the raw reply so Fastify doesn't double-write a body.
      return reply;
    },
  );
};

// Small inline helper — same shape as the one in auth/middleware.ts but the
// access route can't use requireAuth (we want a 200 response when not
// allowed, not 401, so the FE can hide the link without a noisy console
// 401).
function toWebHeaders(headers: Record<string, unknown>): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) webHeaders.append(key, String(v));
    } else {
      webHeaders.set(key, String(value));
    }
  }
  return webHeaders;
}
