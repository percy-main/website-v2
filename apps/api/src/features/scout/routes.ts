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
  deleteFact,
  FactNotFoundError,
  getFact,
  listFacts,
  updateFact,
} from "./facts/admin-service.ts";
import { applyAutoRetrieval } from "./facts/auto-retrieve.ts";
import { createVoyageClient } from "./facts/voyage.ts";
import {
  accessResponseSchema,
  createThreadBodySchema,
  createThreadResponseSchema,
  deleteFactResponseSchema,
  deleteReportResponseSchema,
  deleteThreadResponseSchema,
  factIdParamSchema,
  getThreadResponseSchema,
  listFactsQuerySchema,
  listFactsResponseSchema,
  listReportsResponseSchema,
  listThreadsResponseSchema,
  recentDebriefMatchesResponseSchema,
  reportDownloadResponseSchema,
  reportIdParamSchema,
  threadIdParamSchema,
  updateFactBodySchema,
  updateFactResponseSchema,
} from "./schemas.ts";
import {
  appendMessage,
  assertThreadOwnership,
  bumpThreadUpdatedAt,
  createThread,
  deleteReport,
  deleteThread,
  getReportForDownload,
  getThread,
  listRecentDebriefMatches,
  listReports,
  listThreads,
  ReportNotFoundError,
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
  const recentMatches = listRecentDebriefMatches(app.db);
  const reportsList = listReports(app.db);
  const reportForDownload = getReportForDownload(app.db);
  const reportDelete = deleteReport(app.db);
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
      return await create(user.id, request.body.title, request.body.mode);
    },
  );

  // ── Debrief launcher ──
  // Recent Percy Main matches (last 14d) so the FE can offer them as
  // clickable cards when the captain starts a debrief thread. The
  // free-text/URL fallback in the FE bypasses this entirely.
  app.get(
    "/scout/debrief/recent-matches",
    {
      preHandler: [requireScoutAccess],
      schema: {
        response: { 200: recentDebriefMatchesResponseSchema },
      },
    },
    async () => ({ matches: await recentMatches() }),
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

      let threadMode: "scouting" | "debrief";
      try {
        const owned = await assertOwned(user.id, threadId);
        threadMode = owned.mode;
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
      const modelMessagesRaw = await convertToModelMessages(incoming);

      // Voyage is optional. When configured, run pre-turn fact retrieval
      // and inject the <known-facts> block into the last user message
      // before streamText sees it. Same client instance is passed to the
      // agent so fact_retrieve / fact_record reuse it.
      const voyage = app.config.VOYAGE_API_KEY
        ? createVoyageClient({
            apiKey: app.config.VOYAGE_API_KEY,
            embedModel: app.config.VOYAGE_EMBED_MODEL,
            rerankModel: app.config.VOYAGE_RERANK_MODEL,
          })
        : undefined;

      let modelMessages = modelMessagesRaw;
      let injectedFactsCount = 0;
      if (voyage) {
        try {
          const result = await applyAutoRetrieval(
            { db: app.db, voyage, userId: user.id },
            incoming,
            modelMessagesRaw,
          );
          modelMessages = result.messages;
          injectedFactsCount = result.factsCount;
        } catch (err) {
          // Fact retrieval failure must not break the chat turn. Log and
          // proceed with no injected facts — the agent still has its
          // tools to recover. Voyage errors carry structured detail
          // (status, endpoint, raw body) on the error itself; pino picks
          // them up automatically from the err field.
          app.log.error(
            { err, threadId },
            "scout: auto-retrieval failed; continuing without fact injection",
          );
        }
      }

      // Token usage and Anthropic cache-control metadata are captured inside
      // execute() and read back in onFinish. We can't await result.usage /
      // result.providerMetadata from outside because `result` is local to the
      // stream's execute closure.
      let usagePromise:
        | Promise<{
            inputTokens?: number;
            outputTokens?: number;
            cacheRead?: number;
            cacheCreation?: number;
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
              cacheRead: usage.cacheRead,
              cacheCreation: usage.cacheCreation,
            });
            await bump(threadId);
            // Best-effort: rename the thread if it still has the
            // placeholder title. Failures don't break the chat turn.
            await generateTitle(threadId, firstUserText);

            // Per-turn structured line for cost analysis. cacheRead /
            // cacheCreation come from result.providerMetadata.anthropic;
            // null/undefined means the Anthropic provider didn't report them
            // this turn (tool-only step, or non-Anthropic model).
            // cacheReadRatio answers "how much of the input was served from
            // cache" — the headline number for whether prompt caching is
            // firing across the multi-step agent loop.
            const inputTokens = usage.inputTokens ?? 0;
            const cacheRead = usage.cacheRead;
            const cacheReadRatio =
              inputTokens > 0 && cacheRead != null
                ? Number((cacheRead / (inputTokens + cacheRead)).toFixed(3))
                : null;
            app.log.info(
              {
                event: "scout.turn",
                threadId,
                inputTokens,
                outputTokens: usage.outputTokens ?? 0,
                cacheReadTokens: cacheRead ?? 0,
                cacheCreationTokens: usage.cacheCreation ?? 0,
                cacheReadRatio,
                injectedFactsCount,
              },
              "scout turn complete",
            );
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
            logger: app.log,
            voyage,
            userId: user.id,
            threadId,
            mode: threadMode,
            scoutReports: app.scoutReports,
          });

          const result = streamText({
            model: agent.model,
            system: agent.system,
            tools: agent.tools,
            messages: modelMessages,
            stopWhen: stepCountIs(agent.maxSteps),
            prepareStep: agent.prepareStep,
            onError: ({ error }) => {
              app.log.error(
                { err: sanitizeError(error) },
                "scout streamText error",
              );
            },
          });
          usagePromise = Promise.all([
            result.usage,
            result.providerMetadata,
          ]).then(([u, providerMeta]) => {
            const anthropicMeta = providerMeta?.anthropic as
              | {
                  cacheCreationInputTokens?: number;
                  cacheReadInputTokens?: number;
                }
              | undefined;
            return {
              inputTokens: u.inputTokens ?? undefined,
              outputTokens: u.outputTokens ?? undefined,
              cacheRead: anthropicMeta?.cacheReadInputTokens,
              cacheCreation: anthropicMeta?.cacheCreationInputTokens,
            };
          });

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

  // ── Fact admin ──
  // Allowlist-gated CRUD over the scout_fact corpus. Lets the admin
  // review agent-recorded knowledge and prune bad facts before they
  // compound. Edits to `content` re-embed via Voyage; edits to scope/
  // tags/confidence don't (no semantic change).
  const list_ = listFacts(app.db);
  const get_ = getFact(app.db);
  const remove_ = deleteFact(app.db);

  app.get(
    "/scout/facts",
    {
      preHandler: [requireScoutAccess],
      schema: {
        querystring: listFactsQuerySchema,
        response: { 200: listFactsResponseSchema },
      },
    },
    async (request) => list_(request.query),
  );

  app.patch(
    "/scout/facts/:factId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: factIdParamSchema,
        body: updateFactBodySchema,
        response: { 200: updateFactResponseSchema },
      },
    },
    async (request) => {
      // updateFact needs Voyage to re-embed when content changes.
      // Without an API key we can still allow metadata-only edits;
      // refuse content edits with 503 so the admin gets a clear signal
      // rather than a silent stale-vector bug.
      if (!app.config.VOYAGE_API_KEY && request.body.content !== undefined) {
        throw Object.assign(
          new Error(
            "Editing fact content requires VOYAGE_API_KEY (the embedding must be regenerated). Set the env var or edit metadata only.",
          ),
          { statusCode: 503 },
        );
      }
      const voyage = app.config.VOYAGE_API_KEY
        ? createVoyageClient({
            apiKey: app.config.VOYAGE_API_KEY,
            embedModel: app.config.VOYAGE_EMBED_MODEL,
            rerankModel: app.config.VOYAGE_RERANK_MODEL,
          })
        : // updateFact only calls embed when content changed; the guard
          // above guarantees we never reach voyage.embed without a key.
          ({} as never);
      try {
        return await updateFact(app.db, voyage)(
          request.params.factId,
          request.body,
        );
      } catch (err) {
        if (err instanceof FactNotFoundError) {
          throw Object.assign(new Error("Fact not found"), { statusCode: 404 });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/scout/facts/:factId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: factIdParamSchema,
        response: { 200: deleteFactResponseSchema },
      },
    },
    async (request) => {
      try {
        await remove_(request.params.factId);
        return { ok: true as const };
      } catch (err) {
        if (err instanceof FactNotFoundError) {
          throw Object.assign(new Error("Fact not found"), { statusCode: 404 });
        }
        throw err;
      }
    },
  );

  // Single-fact getter — used by the admin UI for the edit drawer.
  app.get(
    "/scout/facts/:factId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: factIdParamSchema,
        response: { 200: updateFactResponseSchema },
      },
    },
    async (request) => {
      try {
        return await get_(request.params.factId);
      } catch (err) {
        if (err instanceof FactNotFoundError) {
          throw Object.assign(new Error("Fact not found"), { statusCode: 404 });
        }
        throw err;
      }
    },
  );

  // ── Reports (Historical reports tab) ──
  // Reports are user-private and listed globally across threads. Mode is
  // not relevant — they live outside the chat lifecycle.

  app.get(
    "/scout/reports",
    {
      preHandler: [requireScoutAccess],
      schema: { response: { 200: listReportsResponseSchema } },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const reports = await reportsList(user.id);
      return { reports };
    },
  );

  app.get(
    "/scout/reports/:reportId/download",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: reportIdParamSchema,
        response: { 200: reportDownloadResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      try {
        const { s3Key, title } = await reportForDownload(
          user.id,
          request.params.reportId,
        );
        // Build a friendly filename from the report title — stripped of
        // anything that might confuse a Content-Disposition header.
        const safeTitle =
          title.replace(/[^A-Za-z0-9 _.-]/g, "_").slice(0, 80) || "report";
        const url = await app.scoutReports.getSignedReportUrl(
          s3Key,
          `${safeTitle}.pdf`,
        );
        return { url, expiresInSeconds: 30 * 60 };
      } catch (err) {
        if (err instanceof ReportNotFoundError) {
          throw Object.assign(new Error("Report not found"), {
            statusCode: 404,
          });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/scout/reports/:reportId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: reportIdParamSchema,
        response: { 200: deleteReportResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      try {
        const { s3Key } = await reportDelete(user.id, request.params.reportId);
        // Best-effort S3 cleanup. The bucket lifecycle rule will eventually
        // sweep the object even if this fails, so we don't roll back the DB
        // delete on a downstream error — the row is the source of truth.
        try {
          await app.scoutReports.deleteReport(s3Key);
        } catch (s3Err) {
          app.log.warn(
            { err: s3Err, s3Key },
            "scout report S3 delete failed; lifecycle rule will clean up",
          );
        }
        return { ok: true as const };
      } catch (err) {
        if (err instanceof ReportNotFoundError) {
          throw Object.assign(new Error("Report not found"), {
            statusCode: 404,
          });
        }
        throw err;
      }
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
