import { z } from "zod";

export const accessResponseSchema = z.object({
  allowed: z.boolean(),
  email: z.string().nullable(),
});

export const threadIdParamSchema = z.object({
  threadId: z.uuid(),
});

export const scoutModeSchema = z.enum(["scouting", "debrief"]);
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
  mode: scoutModeSchema.default("scouting"),
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
