import { z } from "zod";

export const accessResponseSchema = z.object({
  allowed: z.boolean(),
  email: z.string().nullable(),
});

export const threadIdParamSchema = z.object({
  threadId: z.uuid(),
});

// Scout interaction modes:
// - chat: free-form research conversation (was "scouting" pre-rename).
// - debrief: guided post-match interview, ask_question-driven.
// - scout: focused single-match scout, kicked off from the upcoming-fixtures
//   launcher. Same tool surface as chat, dedicated system prompt that drives
//   toward generate_report.
export const scoutModeSchema = z.enum(["chat", "debrief", "scout"]);
export type ScoutMode = z.infer<typeof scoutModeSchema>;

export const threadSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  mode: scoutModeSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listThreadsResponseSchema = z.object({
  threads: z.array(threadSummarySchema),
});

export const createThreadBodySchema = z.object({
  title: z.string().min(1).max(200).default("New thread"),
  mode: scoutModeSchema.default("chat"),
});

export const createThreadResponseSchema = threadSummarySchema;

// Message parts are AI SDK UIMessage parts (text, tool-call, tool-result,
// reasoning, …). Their schema varies by part type and we don't validate
// shape here — the FE useChat client handles rendering and the agent
// produced them in the first place. Keep as `unknown` so we don't fight
// the type system over an internal AI SDK contract.
export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  parts: z.array(z.unknown()),
  createdAt: z.iso.datetime(),
  // Track 1: attachment ids the user pinned to this user-turn. Empty for
  // assistant turns and historical user turns that pre-date the feature.
  attachmentIds: z.array(z.uuid()).default([]),
});

// Body for the streaming chat route. `messages` matches the AI SDK
// UIMessage shape that useChat sends — too internal to model in Zod, so
// kept as an opaque array. `thinkingMode` is the per-turn reasoning toggle
// surfaced by the composer; defaults to "thinking" server-side when
// omitted. Keeping the full body in the schema (rather than casting) so
// the project's Zod-first invariant holds.
export const chatRequestBodySchema = z.object({
  messages: z.array(z.unknown()).min(1),
  thinkingMode: z.enum(["thinking", "fast"]).optional(),
  /**
   * Attachment ids the user pinned to this turn. The route loads each
   * (verifying thread ownership + state = 'ready') and injects derived
   * text into the last user message via a <chat-attachments> block.
   * Persisted on the user-turn row so chat-history rendering can show
   * the attachments alongside the message.
   */
  attachmentIds: z.array(z.uuid()).max(20).optional(),
});

export const getThreadResponseSchema = z.object({
  thread: threadSummarySchema,
  messages: z.array(messageSchema),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
  }),
});

export const deleteThreadResponseSchema = z.object({
  ok: z.literal(true),
});

// ── Fact admin ──
// Surface the scout_fact corpus to admin/official users so they can
// review, edit, and delete agent-recorded knowledge before it compounds
// into bad outputs. The `embedding` column is intentionally omitted — it's
// 1024 floats per row, useless to humans, and would balloon the response.

// Mirrors of facts/service.ts shapes for the admin route layer. Kept
// here so /scout/facts schemas live with the other Scout endpoints
// rather than crossing the routes/service boundary; runtime values are
// equivalent.
const adminFactScopeSchema = z.enum(["user", "club"]);
const adminFactTagsSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]),
);

export const factPermanenceSchema = z
  .enum(["permanent", "seasonal", "ephemeral"])
  .nullable();
export type FactPermanence = z.infer<typeof factPermanenceSchema>;

export const factAdminItemSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  scope: adminFactScopeSchema,
  content: z.string(),
  tags: adminFactTagsSchema,
  confidence: z.number().int().min(1).max(5),
  permanence: factPermanenceSchema,
  sourceThreadId: z.uuid().nullable(),
  supersededBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listFactsQuerySchema = z.object({
  scope: adminFactScopeSchema.optional(),
  tag: z
    .string()
    .optional()
    .describe(
      "Tag in 'key:value' form, e.g. 'team:Mitford CC'. Filters via tags @> {key:value}.",
    ),
  q: z.string().optional().describe("Full-text search against fact content."),
  includeSuperseded: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const listFactsResponseSchema = z.object({
  facts: z.array(factAdminItemSchema),
  total: z.number().int().nonnegative(),
});

export const factIdParamSchema = z.object({
  factId: z.uuid(),
});

export const updateFactBodySchema = z.object({
  content: z.string().min(5).max(500).optional(),
  tags: adminFactTagsSchema.optional(),
  scope: adminFactScopeSchema.optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  // Allow explicit null to clear permanence back to "unknown"; omit the
  // field entirely to leave it untouched.
  permanence: factPermanenceSchema.optional(),
});

export const updateFactResponseSchema = factAdminItemSchema;

export const deleteFactResponseSchema = z.object({
  ok: z.literal(true),
});

// ── Debrief mode ──
// Recent Percy Main matches surfaced as launcher options when starting a
// debrief thread. Last 14 days, descending. The FE renders these as
// clickable cards alongside a free-text/URL fallback.
export const recentDebriefMatchSchema = z.object({
  id: z.string(),
  matchDate: z.iso.date(),
  opposition: z.string(),
  homeAway: z.enum(["home", "away"]),
  ourTeam: z.string(),
  result: z.string().nullable(),
});

export const recentDebriefMatchesResponseSchema = z.object({
  matches: z.array(recentDebriefMatchSchema),
});

// ── Scout mode ──
// Upcoming Percy Main fixtures surfaced as launcher options when starting a
// scout (focused single-match) thread. Next 14 days, ascending. Sourced from
// availability_fixture (the local table populated when the captain creates an
// availability request) joined to play_cricket_team for the team name.
export const upcomingScoutMatchSchema = z.object({
  // Play Cricket match id — same identifier the pc_* tools accept.
  id: z.string(),
  matchDate: z.iso.date(),
  matchTime: z.string().nullable(),
  opposition: z.string(),
  homeAway: z.enum(["home", "away"]),
  ourTeam: z.string(),
  competition: z.string().nullable(),
});

export const upcomingScoutMatchesResponseSchema = z.object({
  matches: z.array(upcomingScoutMatchSchema),
});

// ── Reports ──
// AI-generated PDF scouting reports. Listed globally per-user (not scoped
// to a thread) for the "Historical reports" tab.

export const reportSummarySchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  threadTitle: z.string().nullable(),
  title: z.string(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  status: z.enum(["queued", "generating", "ready", "failed"]),
  startedAt: z.number().nullable(),
});

export const listReportsResponseSchema = z.object({
  reports: z.array(reportSummarySchema),
});

export const reportIdParamSchema = z.object({
  reportId: z.uuid(),
});

export const reportDownloadResponseSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number().int().positive(),
});

export const deleteReportResponseSchema = z.object({
  ok: z.literal(true),
});

// Single-report response shape for the FE polling hook. Mirrors
// `ReportData` from @percy-main/shared. The FE re-uses that interface
// via the OpenAPI-generated types.
export const reportDetailResponseSchema = z.object({
  reportId: z.uuid(),
  title: z.string(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  status: z.enum(["queued", "generating", "ready", "failed"]),
  errorMessage: z.string().optional(),
  startedAt: z.number().optional(),
});

export const cancelReportResponseSchema = z.object({
  ok: z.literal(true),
  /** True if the report had already reached a terminal state — the cancel
   *  was a no-op. The FE uses this to suppress a pointless toast. */
  alreadyComplete: z.boolean(),
});

// ── Attachments (Track 1) ──
// Per-thread image / PDF uploads. Three-step flow: mint → browser PUTs to
// uploads bucket → commit (downloads, derives via Haiku, copies to permanent
// bucket). The persisted user message references attachment ids; the chat
// route injects derived text into the model prompt.

export const attachmentKindSchema = z.enum(["image", "pdf"]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentProcessingStateSchema = z.enum([
  "awaiting-upload",
  "processing",
  "ready",
  "failed",
]);

export const attachmentIdParamSchema = z.object({
  threadId: z.uuid(),
  attachmentId: z.uuid(),
});

// Allow-list aligned with what Anthropic accepts as image / document input.
// PDFs only on the file side; everything else is treated as image kind.
const attachmentContentTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export const attachmentMintBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: attachmentContentTypeSchema,
  // Browser-side declared size. Verified at commit against S3 HEAD.
  sizeBytes: z.number().int().positive(),
});

export const attachmentMintResponseSchema = z.object({
  id: z.uuid(),
  kind: attachmentKindSchema,
  filename: z.string(),
  sizeBytes: z.number().int().positive(),
  uploadUrl: z.url(),
  uploadUrlExpiresInSeconds: z.number().int().positive(),
  pendingKey: z.string(),
  processingState: attachmentProcessingStateSchema,
});

export const attachmentCommitResponseSchema = z.object({
  id: z.uuid(),
  kind: attachmentKindSchema,
  filename: z.string(),
  sizeBytes: z.number().int().positive(),
  processingState: attachmentProcessingStateSchema,
  derivedText: z.string().nullable(),
  processingError: z.string().nullable(),
});

export const attachmentDetailResponseSchema = z.object({
  id: z.uuid(),
  kind: attachmentKindSchema,
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  processingState: attachmentProcessingStateSchema,
  derivedText: z.string().nullable(),
  processingError: z.string().nullable(),
  signedUrl: z.url().nullable(),
  signedUrlExpiresInSeconds: z.number().int().positive(),
});

export const attachmentDeleteResponseSchema = z.object({
  ok: z.literal(true),
});

// ── Knowledge base (Track 2) ──
// Admin-uploaded reference documents (PDFs / images / text) the agent
// retrieves chunks from via knowledge_search. CRUD is admin-only,
// uploads use the same three-step flow as attachments (mint → PUT →
// commit) but the worker that ingests is one-shot ECS, not in the
// API request lifecycle.

export const kbDocumentKindSchema = z.enum(["pdf", "image", "text"]);
export type KbDocumentKind = z.infer<typeof kbDocumentKindSchema>;

export const kbDocumentStatusSchema = z.enum([
  "awaiting-upload",
  "queued",
  "ingesting",
  "ready",
  "failed",
]);

export const kbDocumentIdParamSchema = z.object({
  id: z.uuid(),
});

const kbContentTypeSchema = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
]);

// Tags use the same shape as scout_fact (key → string|string[]). Lets
// retrieval scope by team/topic/season exactly as the fact corpus does.
const kbTagsSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string().max(256), z.array(z.string().max(256)).max(20)]),
);

export const kbDocumentSummarySchema = z.object({
  id: z.uuid(),
  uploadedBy: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  kind: kbDocumentKindSchema,
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: kbDocumentStatusSchema,
  errorMessage: z.string().nullable(),
  pageCount: z.number().int().nonnegative().nullable(),
  chunkCount: z.number().int().nonnegative(),
  tags: kbTagsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const kbDocumentListResponseSchema = z.object({
  documents: z.array(kbDocumentSummarySchema),
});

export const kbDocumentListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
});

export const kbDocumentDetailResponseSchema = z.object({
  document: kbDocumentSummarySchema,
  signedUrl: z.url().nullable(),
  signedUrlExpiresInSeconds: z.number().int().positive(),
});

export const kbMintBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: kbContentTypeSchema,
  sizeBytes: z.number().int().positive(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  tags: kbTagsSchema.optional(),
});

export const kbMintResponseSchema = z.object({
  id: z.uuid(),
  kind: kbDocumentKindSchema,
  uploadUrl: z.url(),
  uploadUrlExpiresInSeconds: z.number().int().positive(),
  pendingKey: z.string(),
  status: kbDocumentStatusSchema,
});

export const kbCommitResponseSchema = z.object({
  id: z.uuid(),
  status: kbDocumentStatusSchema,
});

export const kbPatchBodySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  // null clears the description; undefined leaves it alone.
  description: z.string().max(2000).nullable().optional(),
  tags: kbTagsSchema.optional(),
});

export const kbReingestResponseSchema = z.object({
  id: z.uuid(),
  status: kbDocumentStatusSchema,
});

export const kbDeleteResponseSchema = z.object({
  ok: z.literal(true),
});

// Bridge from Track 1 chat attachments → KB.
export const kbSaveFromAttachmentBodySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  tags: kbTagsSchema.optional(),
});

export const kbSaveFromAttachmentResponseSchema = z.object({
  documentId: z.uuid(),
  status: kbDocumentStatusSchema,
});
