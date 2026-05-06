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
import { createScoutAgent, type ThinkingMode } from "./agent.ts";
import { deriveAttachment } from "./attachments/derive.ts";
import {
  appendBlockToLastUserMessage,
  AttachmentInvalidStateError,
  AttachmentMissingError,
  AttachmentNotFoundError,
  AttachmentSizeMismatchError,
  AttachmentSizeTooLargeError,
  commitAttachment,
  deleteAttachment,
  formatAttachmentsBlock,
  getAttachment,
  loadReadyAttachmentsForTurn,
  mintAttachment,
} from "./attachments/service.ts";
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
import { launchScoutKbIngest } from "./knowledge/launch.ts";
import {
  commitDocument,
  deleteDocument,
  type DocumentRow,
  getDocument,
  KbAttachmentNotReadyError,
  KbDocumentInvalidStateError,
  KbDocumentNotFoundError,
  KbDuplicateContentError,
  KbSizeTooLargeError,
  KbUnsupportedContentTypeError,
  KbUploadMissingError,
  KbUploadSizeMismatchError,
  listDocuments,
  mintDocument,
  patchDocument,
  reingestDocument,
  saveAttachmentToKb,
} from "./knowledge/service.ts";
import {
  extractCacheUsage,
  resolveModel,
  type ScoutProvider,
} from "./provider.ts";
import {
  accessResponseSchema,
  attachmentCommitResponseSchema,
  attachmentDeleteResponseSchema,
  attachmentDetailResponseSchema,
  attachmentIdParamSchema,
  attachmentMintBodySchema,
  attachmentMintResponseSchema,
  cancelReportResponseSchema,
  chatRequestBodySchema,
  createThreadBodySchema,
  createThreadResponseSchema,
  deleteFactResponseSchema,
  deleteReportResponseSchema,
  deleteThreadResponseSchema,
  factIdParamSchema,
  getThreadResponseSchema,
  kbCommitResponseSchema,
  kbDeleteResponseSchema,
  kbDocumentDetailResponseSchema,
  kbDocumentIdParamSchema,
  kbDocumentListQuerySchema,
  kbDocumentListResponseSchema,
  kbDocumentSummarySchema,
  kbMintBodySchema,
  kbMintResponseSchema,
  kbPatchBodySchema,
  kbReingestResponseSchema,
  kbSaveFromAttachmentBodySchema,
  kbSaveFromAttachmentResponseSchema,
  listFactsQuerySchema,
  listFactsResponseSchema,
  listReportsResponseSchema,
  listThreadsResponseSchema,
  recentDebriefMatchesResponseSchema,
  reportDetailResponseSchema,
  reportDownloadResponseSchema,
  reportIdParamSchema,
  threadIdParamSchema,
  upcomingScoutMatchesResponseSchema,
  updateFactBodySchema,
  updateFactResponseSchema,
} from "./schemas.ts";
import {
  appendMessage,
  assertThreadOwnership,
  bumpThreadUpdatedAt,
  cancelReport,
  createThread,
  deleteReport,
  deleteThread,
  getReportDetail,
  getReportForDownload,
  getThread,
  listRecentDebriefMatches,
  listReports,
  listThreads,
  listUpcomingScoutMatches,
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
  const upcomingMatches = listUpcomingScoutMatches(app.db);
  const reportsList = listReports(app.db);
  const reportForDownload = getReportForDownload(app.db);
  const reportDelete = deleteReport(app.db);
  const reportDetail = getReportDetail(app.db);
  const reportCancel = cancelReport(app.db);
  const generateTitle = maybeGenerateTitle({
    db: app.db,
    provider: app.config.SCOUT_PROVIDER_SUBAGENT,
    modelId: app.config.SCOUT_MODEL_SUBAGENT,
  });

  // ── Attachments (Track 1) ──
  // Always uses Anthropic Haiku for the deriver — image / PDF input
  // requires Anthropic regardless of SCOUT_PROVIDER_CHAT. The mint route
  // pre-flights ANTHROPIC_API_KEY so users see a 503 before they upload
  // bytes that we'd then refuse to process.
  const attachmentDeps = {
    db: app.db,
    store: app.scoutAttachments,
    derive: deriveAttachment({
      db: app.db,
      modelId: app.config.SCOUT_ATTACHMENT_DERIVE_MODEL,
      maxOutputTokens: app.config.SCOUT_ATTACHMENT_DERIVE_MAX_TOKENS,
      derivedTextMaxBytes: app.config.SCOUT_ATTACHMENT_DERIVED_TEXT_MAX_BYTES,
    }),
    maxImageBytes: app.config.SCOUT_ATTACHMENT_MAX_IMAGE_BYTES,
    maxPdfBytes: app.config.SCOUT_ATTACHMENT_MAX_PDF_BYTES,
    uploadUrlExpirySeconds:
      app.config.SCOUT_ATTACHMENT_UPLOAD_URL_EXPIRY_SECONDS,
  };
  const mintAtt = mintAttachment(attachmentDeps);
  const commitAtt = commitAttachment(attachmentDeps);
  const getAtt = getAttachment(attachmentDeps);
  const deleteAtt = deleteAttachment(attachmentDeps);
  const loadAttForTurn = loadReadyAttachmentsForTurn(attachmentDeps);

  // ── Knowledge base (Track 2) ──
  // Voyage is required for ingest (chunks need embeddings). When
  // VOYAGE_API_KEY is unset we still register the routes — list / get
  // / delete / mint / commit all work — but commit will queue rows
  // that the worker eventually fails on, so the route surface gates
  // ingest-launching paths on having a Voyage client.
  const kbVoyage = app.config.VOYAGE_API_KEY
    ? createVoyageClient({
        apiKey: app.config.VOYAGE_API_KEY,
        embedModel: app.config.VOYAGE_EMBED_MODEL,
        rerankModel: app.config.VOYAGE_RERANK_MODEL,
      })
    : undefined;
  const kbDeps = {
    db: app.db,
    store: app.scoutKnowledgeBase,
    voyage: kbVoyage,
    maxDocumentBytes: app.config.SCOUT_KB_MAX_DOCUMENT_BYTES,
    uploadUrlExpirySeconds: app.config.SCOUT_KB_UPLOAD_URL_EXPIRY_SECONDS,
  };
  const kbList = listDocuments(kbDeps);
  const kbGet = getDocument(kbDeps);
  const kbMint = mintDocument(kbDeps);
  const kbCommit = commitDocument(kbDeps);
  const kbPatch = patchDocument(kbDeps);
  const kbDelete = deleteDocument(kbDeps);
  const kbReingest = reingestDocument(kbDeps);
  const kbBridge = saveAttachmentToKb(kbDeps);

  // Image captioning during KB ingest — Anthropic-only regardless of
  // SCOUT_PROVIDER_CHAT, same as Track 1's deriver. Resolved once at
  // boot so each commit doesn't pay the model lookup cost.
  const kbImageCaptionModel = app.config.ANTHROPIC_API_KEY
    ? resolveModel("anthropic", app.config.SCOUT_ATTACHMENT_DERIVE_MODEL).model
    : null;

  // ── Access probe ──
  // Always 200 so the FE can call this without a noisy 401 when nobody is
  // logged in — `{ allowed: false }` means "hide the link", regardless of
  // whether the visitor is anonymous or authed-but-not-roled.
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
      const role = (session.user as { role?: string | null }).role ?? "user";
      const allowed = role === "admin" || role === "official";
      return { allowed, email: session.user.email };
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

  // ── Scout launcher ──
  // Upcoming Percy Main fixtures (next 14d) so the FE can offer them as
  // clickable cards when the captain starts a focused scout thread. Free-text
  // fallback in the FE handles "match not in availability_fixture yet".
  app.get(
    "/scout/upcoming-matches",
    {
      preHandler: [requireScoutAccess],
      schema: {
        response: { 200: upcomingScoutMatchesResponseSchema },
      },
    },
    async () => ({ matches: await upcomingMatches() }),
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
        body: chatRequestBodySchema,
        hide: true,
      },
    },
    async (request, reply) => {
      const { user } = getAuthSession(request);
      const { threadId } = request.params;

      // Guard: Scout requires the readonly DB client and the API key for
      // every provider this deployment is configured to use. Both are
      // optional in config so non-Scout deployments can boot, but hitting
      // this route without the keys for SCOUT_PROVIDER_CHAT /
      // SCOUT_PROVIDER_SUBAGENT / SCOUT_PROVIDER_DB is a misconfiguration.
      const dbReadonly = app.dbReadonly;
      if (!dbReadonly) {
        throw Object.assign(
          new Error("Scout DB is not configured (set SCOUT_DB_URL)."),
          { statusCode: 503 },
        );
      }
      // Researcher and analyst providers are checked even on chat / debrief
      // sessions because the captain can call generate_report mid-session;
      // failing fast at preflight beats failing inside execute() after the
      // user has already seen a "generating" placeholder card.
      const requiredProviders = new Set<ScoutProvider>([
        app.config.SCOUT_PROVIDER_CHAT,
        app.config.SCOUT_PROVIDER_SUBAGENT,
        app.config.SCOUT_PROVIDER_DB,
        app.config.SCOUT_PROVIDER_REPORT,
      ]);
      if (requiredProviders.has("anthropic") && !app.config.ANTHROPIC_API_KEY) {
        throw Object.assign(
          new Error(
            "ANTHROPIC_API_KEY is not configured but at least one Scout provider is set to anthropic.",
          ),
          { statusCode: 503 },
        );
      }
      if (requiredProviders.has("deepseek") && !app.config.DEEPSEEK_API_KEY) {
        throw Object.assign(
          new Error(
            "DEEPSEEK_API_KEY is not configured but at least one Scout provider is set to deepseek.",
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

      let threadMode: "chat" | "debrief" | "scout";
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

      // request.body is now Zod-validated against chatRequestBodySchema —
      // messages is guaranteed non-empty, thinkingMode is "thinking" |
      // "fast" | undefined. Cast to UIMessage[] is the AI SDK contract; the
      // schema kept its shape opaque on purpose.
      const incoming = request.body.messages as UIMessage[];
      // Per-turn reasoning toggle. Default "thinking" when the FE didn't
      // send the field — current chat model (DeepSeek-v4-pro) reasons by
      // default and most users expect that to remain the floor; the FE
      // flips this to "fast" when the user opts out for a quick follow-up.
      const thinkingMode: ThinkingMode =
        request.body.thinkingMode ?? "thinking";

      const lastMessage = incoming[incoming.length - 1];
      if (lastMessage.role !== "user") {
        throw Object.assign(new Error("Last message must be from the user."), {
          statusCode: 400,
        });
      }

      // Track 1: load attachment summaries upfront. If the FE sent an id we
      // can't find (deleted, not ready, wrong owner), drop it silently —
      // safer than 4xx-ing a chat turn over a stale chip. Cap enforcement
      // happens here against the env-driven config rather than the static
      // schema so ops can tune it without a redeploy; the schema's coarse
      // `.max()` is a hard floor against pathological payloads only.
      const requestedAttachmentIds = request.body.attachmentIds ?? [];
      if (
        requestedAttachmentIds.length > app.config.SCOUT_ATTACHMENT_MAX_PER_TURN
      ) {
        throw Object.assign(
          new Error(
            `Too many attachments for one turn: limit is ${app.config.SCOUT_ATTACHMENT_MAX_PER_TURN}.`,
          ),
          { statusCode: 400 },
        );
      }
      const turnAttachments =
        requestedAttachmentIds.length > 0
          ? await loadAttForTurn({
              threadId,
              userId: user.id,
              attachmentIds: requestedAttachmentIds,
            })
          : [];
      const turnAttachmentIds = turnAttachments.map((a) => a.id);

      // Persist the new user message before the model runs — if streaming
      // fails we still want a record of what was asked. attachment_ids
      // lives on its own column so AI SDK replay (which reads `parts`
      // verbatim) stays clean.
      await append(
        threadId,
        "user",
        lastMessage.parts,
        undefined,
        turnAttachmentIds,
      );

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

      // Track 1: append the <chat-attachments> block AFTER auto-retrieval
      // so both blocks operate on the same base array. The cache-control
      // breakpoint stays on the last message regardless.
      if (turnAttachments.length > 0) {
        const block = formatAttachmentsBlock(turnAttachments);
        modelMessages = appendBlockToLastUserMessage(modelMessages, block);
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
          // Persist on abort too — partial parts (any prose / tool calls /
          // pipeline-card snapshots that streamed before the disconnect) are
          // already on responseMessage. Earlier we skipped this branch and
          // the whole assistant turn vanished when the user navigated away
          // mid-report; surfacing the partial state at least keeps the
          // pipeline card visible on revisit so the user knows what was
          // running. usagePromise may not have resolved on abort — fall back
          // to undefined fields rather than blocking forever.
          if (!responseMessage) return;
          try {
            const usage = isAborted ? {} : ((await usagePromise) ?? {});
            await append(threadId, "assistant", responseMessage.parts, {
              input: usage.inputTokens,
              output: usage.outputTokens,
              cacheRead: usage.cacheRead,
              cacheCreation: usage.cacheCreation,
            });
            await bump(threadId);
            if (isAborted) {
              app.log.warn(
                { event: "scout.turn_aborted", threadId },
                "scout turn aborted; persisted partial assistant message",
              );
              return;
            }
            // Best-effort: rename the thread if it still has the
            // placeholder title. Failures don't break the chat turn.
            await generateTitle(threadId, firstUserText);

            // Per-turn structured line for cost analysis. cacheRead /
            // cacheCreation are extracted by extractCacheUsage and shaped
            // per-provider — Anthropic reports both via providerMetadata,
            // DeepSeek reports cacheRead only via usage.cachedInputTokens
            // and has no separate cache-creation event. Provider is tagged
            // so cross-vendor cost analysis can split the data.
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
                provider: app.config.SCOUT_PROVIDER_CHAT,
                model: app.config.SCOUT_MODEL_CHAT,
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
            scoutKnowledgeBase: app.scoutKnowledgeBase,
            thinkingMode,
          });

          const result = streamText({
            model: agent.model,
            system: agent.system,
            tools: agent.tools,
            messages: modelMessages,
            stopWhen: stepCountIs(agent.maxSteps),
            prepareStep: agent.prepareStep,
            providerOptions: agent.providerOptions,
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
            const cache = extractCacheUsage(
              app.config.SCOUT_PROVIDER_CHAT,
              u,
              providerMeta,
            );
            return {
              inputTokens: u.inputTokens ?? undefined,
              outputTokens: u.outputTokens ?? undefined,
              cacheRead: cache.cacheRead,
              cacheCreation: cache.cacheCreation,
            };
          });

          // sendStart: false because createUIMessageStream emits its own start
          // chunk; merging streamText's would duplicate.
          writer.merge(result.toUIMessageStream({ sendStart: false }));
        },
        onError: (error) => {
          // Provider-side errors (auth, billing, rate limit, etc.) put the
          // raw provider message on error.message — e.g. "Insufficient
          // Balance" from DeepSeek or "invalid x-api-key" from Anthropic.
          // Returning that to the FE leaks operational state of our account
          // to anyone with Scout access, so we log the full sanitized error
          // server-side and surface a generic string to the UI.
          app.log.error({ err: sanitizeError(error) }, "scout UI stream error");
          return "Scout failed to respond. Please try again.";
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

  // ── Attachments (paste / drop / upload) ──
  // Three round-trip flow: mint → browser PUTs to uploads bucket → commit.
  // Mint pre-flights ANTHROPIC_API_KEY so users see a 503 before paying
  // upload bandwidth on a request we'd refuse at commit anyway.

  app.post(
    "/scout/threads/:threadId/attachments",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: threadIdParamSchema,
        body: attachmentMintBodySchema,
        response: { 201: attachmentMintResponseSchema },
      },
    },
    async (request, reply) => {
      if (!app.config.ANTHROPIC_API_KEY) {
        throw Object.assign(
          new Error(
            "ANTHROPIC_API_KEY is not configured; chat attachments require Anthropic Haiku regardless of SCOUT_PROVIDER_CHAT.",
          ),
          { statusCode: 503 },
        );
      }

      const { user } = getAuthSession(request);
      const { threadId } = request.params;
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

      try {
        const result = await mintAtt({
          threadId,
          userId: user.id,
          filename: request.body.filename,
          contentType: request.body.contentType,
          sizeBytes: request.body.sizeBytes,
        });
        reply.code(201);
        return result;
      } catch (err) {
        if (err instanceof AttachmentSizeTooLargeError) {
          throw Object.assign(
            new Error(
              `${err.contentType} exceeds the ${err.limit}-byte limit (got ${err.sizeBytes}).`,
            ),
            { statusCode: 413 },
          );
        }
        throw err;
      }
    },
  );

  app.post(
    "/scout/threads/:threadId/attachments/:attachmentId/commit",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: attachmentIdParamSchema,
        response: { 200: attachmentCommitResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { threadId, attachmentId } = request.params;
      try {
        const summary = await commitAtt({
          threadId,
          userId: user.id,
          attachmentId,
        });
        return summary;
      } catch (err) {
        if (err instanceof AttachmentNotFoundError) {
          throw Object.assign(new Error("Attachment not found"), {
            statusCode: 404,
          });
        }
        if (err instanceof AttachmentMissingError) {
          throw Object.assign(
            new Error(
              "Pending upload not found. The presigned URL may have expired — re-upload from scratch.",
            ),
            { statusCode: 409 },
          );
        }
        if (err instanceof AttachmentSizeMismatchError) {
          throw Object.assign(
            new Error(
              `Uploaded size ${err.actual} does not match declared size ${err.declared}.`,
            ),
            { statusCode: 422 },
          );
        }
        if (err instanceof AttachmentInvalidStateError) {
          throw Object.assign(
            new Error(`Attachment is in ${err.state} state; cannot commit.`),
            { statusCode: 409 },
          );
        }
        // Derive failures, S3 transport failures, and anything else go up
        // as 500. The service has already flipped the row to 'failed' and
        // populated processing_error, so the FE can show a chip with a
        // retry option.
        app.log.error(
          { err, threadId, attachmentId },
          "scout: attachment commit failed",
        );
        throw err;
      }
    },
  );

  app.get(
    "/scout/threads/:threadId/attachments/:attachmentId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: attachmentIdParamSchema,
        response: { 200: attachmentDetailResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { threadId, attachmentId } = request.params;
      try {
        const { summary, signedUrl } = await getAtt({
          threadId,
          userId: user.id,
          attachmentId,
        });
        return {
          ...summary,
          signedUrl,
          signedUrlExpiresInSeconds: 30 * 60,
        };
      } catch (err) {
        if (err instanceof AttachmentNotFoundError) {
          throw Object.assign(new Error("Attachment not found"), {
            statusCode: 404,
          });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/scout/threads/:threadId/attachments/:attachmentId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: attachmentIdParamSchema,
        response: { 200: attachmentDeleteResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const { threadId, attachmentId } = request.params;
      try {
        await deleteAtt({ threadId, userId: user.id, attachmentId });
        return { ok: true as const };
      } catch (err) {
        if (err instanceof AttachmentNotFoundError) {
          throw Object.assign(new Error("Attachment not found"), {
            statusCode: 404,
          });
        }
        throw err;
      }
    },
  );

  // ── Fact admin ──
  // Role-gated CRUD over the scout_fact corpus (admin/official). Lets
  // them review agent-recorded knowledge and prune bad facts before they
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

  // Single-report polling endpoint. The FE pipeline card hits this every
  // ~5s while the report is in flight to drive the live phase + tool-chip
  // state. Once status is 'ready' or 'failed' the FE stops polling.
  app.get(
    "/scout/reports/:reportId",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: reportIdParamSchema,
        response: { 200: reportDetailResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      const detail = await reportDetail(user.id, request.params.reportId);
      if (!detail) {
        throw Object.assign(new Error("Report not found"), { statusCode: 404 });
      }
      return detail;
    },
  );

  // User-initiated cancel from the pipeline card's stop button. Sets the
  // row's cancel_requested flag — the worker's flush picks it up at the
  // next poll (≤1.5s during researcher; immediately at phase boundaries
  // for analyst/render).
  app.post(
    "/scout/reports/:reportId/cancel",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: reportIdParamSchema,
        response: { 200: cancelReportResponseSchema },
      },
    },
    async (request) => {
      const { user } = getAuthSession(request);
      try {
        const result = await reportCancel(user.id, request.params.reportId);
        return { ok: true as const, alreadyComplete: result.alreadyComplete };
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

  // ── Knowledge base routes ──
  // All gated behind requireScoutAccess. The mint route additionally
  // pre-flights ANTHROPIC_API_KEY + VOYAGE_API_KEY because ingest
  // depends on both — admins should see a 503 before paying upload
  // bandwidth on a doc the worker would refuse to process.

  app.get(
    "/scout/knowledge/documents",
    {
      preHandler: [requireScoutAccess],
      schema: {
        querystring: kbDocumentListQuerySchema,
        response: { 200: kbDocumentListResponseSchema },
      },
    },
    async (request) => {
      const { search } = request.query;
      const docs = await kbList({ search });
      return { documents: docs.map(toDocumentSummary) };
    },
  );

  app.post(
    "/scout/knowledge/documents",
    {
      preHandler: [requireScoutAccess],
      schema: {
        body: kbMintBodySchema,
        response: { 201: kbMintResponseSchema },
      },
    },
    async (request, reply) => {
      if (!kbVoyage) {
        throw Object.assign(
          new Error(
            "VOYAGE_API_KEY is not configured; KB ingest requires embeddings.",
          ),
          { statusCode: 503 },
        );
      }
      if (
        !kbImageCaptionModel &&
        request.body.contentType.startsWith("image/")
      ) {
        throw Object.assign(
          new Error(
            "ANTHROPIC_API_KEY is not configured; KB image ingest requires Anthropic Haiku for captioning.",
          ),
          { statusCode: 503 },
        );
      }

      const { user } = getAuthSession(request);
      try {
        const result = await kbMint({
          uploadedBy: user.id,
          filename: request.body.filename,
          contentType: request.body.contentType,
          sizeBytes: request.body.sizeBytes,
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
        });
        reply.code(201);
        return result;
      } catch (err) {
        if (err instanceof KbUnsupportedContentTypeError) {
          throw Object.assign(new Error(err.message), { statusCode: 415 });
        }
        if (err instanceof KbSizeTooLargeError) {
          throw Object.assign(new Error(err.message), { statusCode: 413 });
        }
        throw err;
      }
    },
  );

  app.post(
    "/scout/knowledge/documents/:id/commit",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: kbDocumentIdParamSchema,
        response: { 200: kbCommitResponseSchema },
      },
    },
    async (request) => {
      if (!kbVoyage || !kbImageCaptionModel) {
        throw Object.assign(
          new Error(
            "KB ingest requires VOYAGE_API_KEY and ANTHROPIC_API_KEY to be configured.",
          ),
          { statusCode: 503 },
        );
      }

      const { id } = request.params;
      try {
        const result = await kbCommit(id);
        // Launch the ingestion worker after the row is in 'queued'.
        // Errors here surface as 500 — the row is in 'queued' so a
        // future operator action can re-launch via the reingest
        // endpoint without re-uploading.
        try {
          await launchScoutKbIngest({
            config: app.config,
            inProcessDeps: {
              db: app.db,
              voyage: kbVoyage,
              imageCaptionModel: kbImageCaptionModel,
              scoutKnowledgeBase: app.scoutKnowledgeBase,
              config: app.config,
              logger: app.log,
            },
            documentId: id,
          });
        } catch (launchErr) {
          app.log.error(
            { err: launchErr, documentId: id },
            "scout KB worker launch failed",
          );
          throw Object.assign(
            new Error(
              "Document committed but worker launch failed. Re-trigger via /reingest.",
            ),
            { statusCode: 500 },
          );
        }
        return { id: result.id, status: result.status };
      } catch (err) {
        if (err instanceof KbDocumentNotFoundError) {
          throw Object.assign(new Error(err.message), { statusCode: 404 });
        }
        if (err instanceof KbUploadMissingError) {
          throw Object.assign(
            new Error(
              "Pending upload not found. The presigned URL may have expired — re-upload from scratch.",
            ),
            { statusCode: 409 },
          );
        }
        if (err instanceof KbUploadSizeMismatchError) {
          throw Object.assign(new Error(err.message), { statusCode: 422 });
        }
        if (err instanceof KbDocumentInvalidStateError) {
          throw Object.assign(
            new Error(`Document is in ${err.state} state; cannot commit.`),
            { statusCode: 409 },
          );
        }
        if (err instanceof KbDuplicateContentError) {
          throw Object.assign(
            new Error(
              `An identical document is already in the KB (id=${err.existingDocumentId}).`,
            ),
            { statusCode: 409 },
          );
        }
        throw err;
      }
    },
  );

  app.get(
    "/scout/knowledge/documents/:id",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: kbDocumentIdParamSchema,
        response: { 200: kbDocumentDetailResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      try {
        const { document, signedUrl } = await kbGet(id);
        return {
          document: toDocumentSummary(document),
          signedUrl,
          signedUrlExpiresInSeconds: 30 * 60,
        };
      } catch (err) {
        if (err instanceof KbDocumentNotFoundError) {
          throw Object.assign(new Error(err.message), { statusCode: 404 });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/scout/knowledge/documents/:id",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: kbDocumentIdParamSchema,
        body: kbPatchBodySchema,
        response: { 200: kbDocumentSummarySchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      try {
        const updated = await kbPatch(id, {
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
        });
        return toDocumentSummary(updated);
      } catch (err) {
        if (err instanceof KbDocumentNotFoundError) {
          throw Object.assign(new Error(err.message), { statusCode: 404 });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/scout/knowledge/documents/:id",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: kbDocumentIdParamSchema,
        response: { 200: kbDeleteResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      try {
        await kbDelete(id);
        return { ok: true as const };
      } catch (err) {
        if (err instanceof KbDocumentNotFoundError) {
          throw Object.assign(new Error(err.message), { statusCode: 404 });
        }
        throw err;
      }
    },
  );

  app.post(
    "/scout/knowledge/documents/:id/reingest",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: kbDocumentIdParamSchema,
        response: { 200: kbReingestResponseSchema },
      },
    },
    async (request) => {
      if (!kbVoyage || !kbImageCaptionModel) {
        throw Object.assign(
          new Error(
            "KB ingest requires VOYAGE_API_KEY and ANTHROPIC_API_KEY to be configured.",
          ),
          { statusCode: 503 },
        );
      }
      const { id } = request.params;
      try {
        const result = await kbReingest(id);
        try {
          await launchScoutKbIngest({
            config: app.config,
            inProcessDeps: {
              db: app.db,
              voyage: kbVoyage,
              imageCaptionModel: kbImageCaptionModel,
              scoutKnowledgeBase: app.scoutKnowledgeBase,
              config: app.config,
              logger: app.log,
            },
            documentId: id,
          });
        } catch (launchErr) {
          app.log.error(
            { err: launchErr, documentId: id },
            "scout KB reingest worker launch failed",
          );
          throw Object.assign(
            new Error("Reingest queued but worker launch failed."),
            { statusCode: 500 },
          );
        }
        return result;
      } catch (err) {
        if (err instanceof KbDocumentNotFoundError) {
          throw Object.assign(new Error(err.message), { statusCode: 404 });
        }
        if (err instanceof KbDocumentInvalidStateError) {
          throw Object.assign(
            new Error(
              `Document is in ${err.state} state; cannot reingest (must be committed at least once).`,
            ),
            { statusCode: 409 },
          );
        }
        throw err;
      }
    },
  );

  // ── Track 1 → KB bridge ──
  // Promote a chat attachment into the KB. Bytes already live in the
  // attachments bucket; service-side CopyObject lifts them across.
  app.post(
    "/scout/threads/:threadId/attachments/:attachmentId/save-to-kb",
    {
      preHandler: [requireScoutAccess],
      schema: {
        params: attachmentIdParamSchema,
        body: kbSaveFromAttachmentBodySchema,
        response: { 201: kbSaveFromAttachmentResponseSchema },
      },
    },
    async (request, reply) => {
      if (!kbVoyage || !kbImageCaptionModel) {
        throw Object.assign(
          new Error(
            "KB ingest requires VOYAGE_API_KEY and ANTHROPIC_API_KEY to be configured.",
          ),
          { statusCode: 503 },
        );
      }

      const { user } = getAuthSession(request);
      const { threadId, attachmentId } = request.params;

      // Reuse the existing attachment ownership check — user must own
      // the thread the attachment belongs to.
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

      const attachment = await app.db
        .selectFrom("scout_attachment")
        .where("id", "=", attachmentId)
        .where("thread_id", "=", threadId)
        .where("user_id", "=", user.id)
        .selectAll()
        .executeTakeFirst();
      if (!attachment) {
        throw Object.assign(new Error("Attachment not found"), {
          statusCode: 404,
        });
      }
      if (
        !attachment.s3_key ||
        !attachment.content_hash ||
        attachment.processing_state !== "ready"
      ) {
        throw Object.assign(
          new Error(
            `Attachment is in ${attachment.processing_state} state; only ready attachments can be saved to the KB.`,
          ),
          { statusCode: 409 },
        );
      }

      try {
        const result = await kbBridge({
          attachment: {
            id: attachment.id,
            threadId: attachment.thread_id,
            userId: attachment.user_id,
            kind: attachment.kind,
            contentType: attachment.content_type,
            filename: attachment.filename,
            sizeBytes: attachment.size_bytes,
            s3Key: attachment.s3_key,
            contentHash: attachment.content_hash,
            processingState: attachment.processing_state,
          },
          sourceBucket: app.config.SCOUT_ATTACHMENTS_BUCKET,
          uploadedBy: user.id,
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
        });

        try {
          await launchScoutKbIngest({
            config: app.config,
            inProcessDeps: {
              db: app.db,
              voyage: kbVoyage,
              imageCaptionModel: kbImageCaptionModel,
              scoutKnowledgeBase: app.scoutKnowledgeBase,
              config: app.config,
              logger: app.log,
            },
            documentId: result.documentId,
          });
        } catch (launchErr) {
          app.log.error(
            { err: launchErr, documentId: result.documentId },
            "scout KB bridge worker launch failed",
          );
          throw Object.assign(
            new Error(
              "Saved to KB but worker launch failed; trigger reingest from the KB admin.",
            ),
            { statusCode: 500 },
          );
        }

        reply.code(201);
        return result;
      } catch (err) {
        if (err instanceof KbAttachmentNotReadyError) {
          throw Object.assign(new Error(err.message), { statusCode: 409 });
        }
        if (err instanceof KbDuplicateContentError) {
          throw Object.assign(
            new Error(
              `An identical document is already in the KB (id=${err.existingDocumentId}).`,
            ),
            { statusCode: 409 },
          );
        }
        if (err instanceof KbSizeTooLargeError) {
          throw Object.assign(new Error(err.message), { statusCode: 413 });
        }
        if (err instanceof KbUnsupportedContentTypeError) {
          throw Object.assign(new Error(err.message), { statusCode: 415 });
        }
        throw err;
      }
    },
  );
};

// Format service-side DocumentRow into the wire shape declared by the
// schema. Service has Date objects + structured tags; schema expects
// ISO strings.
function toDocumentSummary(row: DocumentRow) {
  return {
    id: row.id,
    uploadedBy: row.uploadedBy,
    title: row.title,
    description: row.description,
    kind: row.kind,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    errorMessage: row.errorMessage,
    pageCount: row.pageCount,
    chunkCount: row.chunkCount,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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
