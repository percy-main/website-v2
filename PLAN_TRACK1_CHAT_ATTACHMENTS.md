# PLAN — Track 1: Scout chat attachments (ephemeral)

Let users paste / drop / upload images and PDFs into a Scout chat. The
agent sees the content as text (caption for images, extracted text for
PDFs) so DeepSeek can use it without a vision-capable provider.
Originals are stored in S3 for chat-history rendering and are not
persisted as facts. A future "Save to KB" action (Track 2) bridges
ephemeral attachments into the persistent Knowledge Base.

## Constraints settled in design discussion

- **Provider**: chat agent stays on DeepSeek. Both images and PDFs are
  derived to text by Anthropic Haiku (`claude-haiku-4-5-20251001` —
  already configured as `SCOUT_MODEL_SUBAGENT` / `SCOUT_MODEL_DB`, no
  new dependency). Anthropic accepts PDFs as a native `document`
  content block (≤32MB, ≤100 pages), so we don't need a server-side
  PDF library. One Haiku call per attachment, kind-specific prompt.
- **Lifecycle**: attachments are tied to a thread. They are not
  promoted to facts automatically — the agent's existing `fact_record`
  tool handles that when something durable surfaces. No S3 lifecycle
  rule on the permanent bucket — object lifetime tracks thread
  lifetime via `ON DELETE CASCADE`. Orphaned bytes from a deleted
  thread are tolerated (Track 1 is admin/official-only, low volume).
- **Caching**: derived-text reuse keyed by SHA-256 of the file bytes.
  Same image/PDF reuploaded by anyone reuses the cached output. Cache
  is global (cross-user) — acceptable because Scout is gated to
  admin/official.
- **Caption style**: broad / factual for images; transcribe + summarise
  for PDFs. A team-sheet cricket-aware mode is out of scope for v1;
  the agent can ask follow-ups.
- **Size caps**: hard reject above limits. Initial: 10MB images, 10MB
  PDFs. No explicit page cap (Haiku's 100-page limit covers it). Cap
  derived text at 250KB as a sanity bound. Tunable via config.
- **Commit timing**: synchronous. The FE blocks the send button until
  commit returns. A 10MB PDF + Haiku roundtrip can plausibly take
  10–15s; revisit with async + polling if it becomes painful.

## What changes — at a glance

```
apps/api/src/
├── app.ts                                EDIT — decorate app with scoutAttachments store + extend declare module block
├── lib/
│   └── s3-scout-attachments.ts           NEW — two-bucket S3 store (pattern from s3-documents.ts):
│                                                getSignedUploadUrl, headPending, getPending,
│                                                copyToPermanent, deletePending, deletePermanent,
│                                                getSignedAttachmentUrl
└── features/scout/
    ├── attachments/
    │   ├── service.ts                    NEW — upload, derive, fetch
    │   ├── derive.ts                     NEW — Haiku deriver (image + PDF) with cache lookup
    │   ├── service.test.ts               NEW
    │   └── integration.test.ts           NEW
    ├── routes.ts                         EDIT — add /scout/threads/:id/attachments routes
    │                                            inject attachment text on chat turn
    ├── schemas.ts                        EDIT — attachment Zod schemas
    └── auth.ts                           UNCHANGED — requireScoutAccess covers new routes

packages/db/src/migrations/
└── <ts>-scout-attachment.ts              NEW — scout_attachment + scout_attachment_cache

apps/web/src/pages/scout/
├── composer.tsx                          EDIT — paste/drop, preview, upload
├── attachments/
│   ├── attachment-preview.tsx            NEW
│   └── use-attachment-upload.ts          NEW — react-query mutation
└── scout.tsx                             EDIT — wire attachment IDs into sendMessage body
```

## Schema

```sql
-- Per-thread upload record. Lifetime = thread lifetime.
CREATE TABLE scout_attachment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES scout_thread(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,        -- 'image' | 'pdf'
  content_type    TEXT NOT NULL,        -- e.g. image/png, application/pdf
  size_bytes      INTEGER NOT NULL,     -- declared at mint; verified at commit
  filename        TEXT NOT NULL,        -- original filename, for UI
  -- Uploads-bucket key, set at mint. Cleared (or kept for forensics)
  -- after a successful commit-and-copy to the permanent bucket.
  pending_key     TEXT,
  -- Permanent-bucket key. NULL until commit succeeds.
  s3_key          TEXT,
  -- sha256 hex from the uploaded bytes. NULL until commit succeeds.
  content_hash    TEXT,
  -- Resolved derived text. NULL until processing succeeds.
  -- Image: Haiku caption. PDF: extracted text (truncated to a hard cap).
  derived_text    TEXT,
  processing_state TEXT NOT NULL,
  processing_error TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind IN ('image','pdf')),
  CHECK (processing_state IN
    ('awaiting-upload','processing','ready','failed'))
);
CREATE INDEX scout_attachment_thread_idx ON scout_attachment(thread_id);
CREATE INDEX scout_attachment_hash_idx ON scout_attachment(content_hash);

-- Track which attachments were attached to which user turn. Stored as
-- a column rather than via scout_message.parts (which is set verbatim
-- from AI SDK UIMessage parts and must stay clean for replay).
ALTER TABLE scout_message ADD COLUMN attachment_ids UUID[];

-- Content-addressed cache for derived text. Survives attachment row
-- deletion, so re-uploading the same image doesn't re-hit Haiku.
CREATE TABLE scout_attachment_cache (
  content_hash    TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  derived_text    TEXT NOT NULL,
  source          TEXT NOT NULL,        -- 'haiku-caption' | 'pdf-extract'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Upload flow — pre-signed PUT (two-bucket)

Mirror the `s3-documents.ts` pattern: a separate uploads bucket for
pending browser uploads (24h lifecycle), and a permanent attachments
bucket. Bytes never touch the API process — the API mints a signed
PUT URL, the browser uploads directly to S3, then the API commits
(downloads, hashes, captions/extracts, copies to permanent bucket).

Three round-trips per attachment:

1. **Mint** — `POST /scout/threads/:id/attachments` with metadata only
   (filename, contentType, sizeBytes). API validates the metadata
   (extension, type allow-list, size cap), inserts a `scout_attachment`
   row with `processing_state='awaiting-upload'` and a `pendingKey`,
   and returns `{ id, uploadUrl, uploadUrlExpiresInSeconds, pendingKey }`.
2. **Upload** — browser PUTs the file bytes directly to `uploadUrl`
   (uploads bucket). 15-minute URL expiry, same as `s3-documents.ts`.
3. **Commit** — `POST /scout/threads/:id/attachments/:attachmentId/commit`.
   API downloads from the uploads bucket, computes SHA-256, checks
   the derived-text cache, runs caption / extraction, copies the
   original to the permanent attachments bucket, updates the row to
   `ready` (or `failed`).

Why this is worth the extra step on a 10MB cap:

- Cleaner division of concerns — the API never sits on megabyte
  bodies; ECS task memory and request timeouts stay predictable.
- The body-validation invariant from CLAUDE.md is preserved (mint and
  commit are both normal JSON-body Zod-validated routes).
- The pattern already exists in this codebase (`s3-documents.ts`),
  so no new plugin / no new convention.
- Gives us headroom: raising the cap later (e.g. for Track 2) is a
  config change, not a redesign.

Trade-offs the user should know about:

- Extra moving parts: 3 round-trips, two buckets, CORS on the uploads
  bucket so the browser PUT is allowed.
- A user can mint + upload + never commit — orphaned bytes in the
  uploads bucket. Mitigated by the 24h lifecycle rule (S3 expires the
  object) and a cleanup pass on `awaiting-upload` rows older than the
  URL expiry window.
- Hash check happens at commit time, not before upload — so a
  duplicate-of-cached image still costs the upload bandwidth before
  we discover the cache hit. Acceptable: bandwidth is browser-side
  (cheap), and the cache hit still skips the expensive Haiku call.

## Routes

```ts
// All gated by requireScoutAccess. Scoped to thread; ownership checked
// the same way as POST /scout/threads/:threadId/messages.

POST   /scout/threads/:threadId/attachments
       JSON body: { filename, contentType, sizeBytes }
       → 201 { id, uploadUrl, uploadUrlExpiresInSeconds, pendingKey,
               kind, filename, sizeBytes, processingState: 'awaiting-upload' }
       Pre-flight: 503 if ANTHROPIC_API_KEY is not configured (Haiku is on
       the chat-time hot path here, regardless of SCOUT_PROVIDER_CHAT).

POST   /scout/threads/:threadId/attachments/:attachmentId/commit
       JSON body: {}    (the attachment row already knows its pendingKey)
       → 200 { id, kind, filename, sizeBytes, processingState, derivedText? }
       Idempotent: re-calling on a 'ready' row is a no-op.
       Errors: 409 if the uploads-bucket object is missing (URL expired,
       upload never happened); 422 if size/type don't match what was
       declared at mint time.

GET    /scout/threads/:threadId/attachments/:attachmentId
       → 200 { id, kind, filename, contentType, sizeBytes, processingState,
               derivedText, signedUrl, signedUrlExpiresInSeconds }

DELETE /scout/threads/:threadId/attachments/:attachmentId
       → 200 { ok: true }
       Deletes both the DB row and the S3 object (mirrors deleteReport
       in routes.ts; never leaves orphaned S3 bytes).
```

Optional follow-up endpoint `POST /scout/threads/:threadId/attachments/:id/save-to-kb`
lands when Track 2 ships.

## Processing pipeline

The commit endpoint runs synchronously — the FE disables the send
button until commit returns. Steps:

1. Look up the `scout_attachment` row; assert ownership + state
   `awaiting-upload`. Flip to `processing_state='processing'`.
2. `HeadObject` on the uploads bucket to confirm the upload happened
   and that size matches what was declared at mint time. Reject with
   422 if mismatched, 409 if missing.
3. `GetObject` from the uploads bucket → `Buffer`.
4. Compute `sha256` hex from the buffer.
5. **Cache hit?** Read `derived_text` from `scout_attachment_cache`,
   set on row, skip step 6.
6. Cache miss — call Haiku via AI SDK `generateText`:
   - **Image**: single image content block + generic factual prompt.
   - **PDF**: single `file` content block (`mediaType: 'application/pdf'`,
     base64 data) + transcribe-and-summarise prompt. Anthropic accepts
     PDFs natively up to 32MB / 100 pages.
   - Cap output tokens via `SCOUT_ATTACHMENT_DERIVE_MAX_TOKENS`.
   - Truncate derived text at 250KB as a sanity bound.
   - Persist to `scout_attachment_cache(content_hash)`.
7. `CopyObject` from uploads bucket to permanent bucket at
   `${prefix}/${threadId}/${attachmentId}.${ext}`.
8. Update row to `processing_state='ready'`, populate `derived_text`,
   `s3_key`, `content_hash`.
9. Best-effort `DeleteObject` on the uploads-bucket pending key. If
   the delete fails, the 24h lifecycle rule will reap it.

**Failure modes**:

- Step 2/3 missing or wrong size → row stays in failed state, user
  sees an error chip and can retry from scratch.
- Haiku / PDF extraction failure → `processing_state='failed'`,
  `processing_error` populated, original bytes left in the uploads
  bucket so a retry could re-process without re-uploading (future
  enhancement; v1 just makes the user re-upload).
- `CopyObject` failure → row failed, uploads-bucket bytes expire
  naturally.

**Cleanup pass**: a periodic job (or a small cron) scans
`scout_attachment` rows in `awaiting-upload` past the URL expiry
window, marks them `failed`, and deletes the pending S3 key. Defer
to a follow-up; the 24h S3 lifecycle covers the bytes-cost case.

## Derive prompts (v1)

**Image:**

```
You will be shown an image. Describe its contents factually and
concretely in 2–4 short sentences. Cover what is visible: people,
objects, text, layout, setting. Do not interpret, speculate, or
identify named individuals. If text is visible, transcribe key
text verbatim where useful (team sheets, scoreboards, captions).
```

**PDF:**

```
You will be shown a PDF document. Transcribe the readable text
verbatim (preserve names, numbers, headings, and tabular structure
where possible). After the transcription, add a short factual
summary (2–4 sentences) of what the document is and contains. Do
not interpret or speculate beyond what is on the page.
```

Both anchored to verbatim transcription so the team-sheet / scoring
sheet / fixture-list use cases work without specialised prompting.

## Chat turn integration

Two options for surfacing attachment text to the agent:

1. **Append to the last user message** — same shape as
   `applyAutoRetrieval` (`facts/auto-retrieve.ts`), wrap in a
   `<chat-attachments>` block.
2. **Pass as a tool / additional context block** — not preferred;
   adds an indirection the agent has to navigate.

Go with option 1. Concretely: `chatRequestBodySchema` gains an
optional `attachmentIds: string[]`. The route loads the attachments
for those ids (verifying thread ownership + state = `ready`), assembles
a block, and appends it to the last user message AFTER
`convertToModelMessages`. **Ordering matters**: the attachment
injection must run on the result of `applyAutoRetrieval`
(i.e. `result.messages`), not on `modelMessagesRaw`, otherwise the
two blocks operate on different base arrays. Reuse / mirror
`appendBlockToLastUserMessage` from `auto-retrieve.ts:83-104` —
it already correctly handles the `string | Array<...>` content
shape and preserves any image/file parts. The cache-control
breakpoint stays on the last message regardless.

```
<chat-attachments>
- [attachment:image] team-sheet.png — <derived_text>
- [attachment:pdf] swalwell-2024-report.pdf (8 pages) — <derived_text>
</chat-attachments>
```

The persisted user message keeps a lightweight reference; it does NOT
inline the derived text, so re-renders don't double-inject.

**Persistence: dedicated column, not parts-metadata.** `scout_message.parts`
is set verbatim from the AI SDK UIMessage parts at `service.ts:appendMessage`
— polluting it with attachment ids would corrupt AI SDK replay.
Instead, add a nullable `attachment_ids UUID[]` column to `scout_message`
in the same migration, and populate it on the user-turn append in the
chat route. On thread replay, the FE fetches per-id signed URLs lazily
to render thumbnails alongside the message.

## Frontend composer

`apps/web/src/pages/scout/composer.tsx`:

- `onPaste`, `onDrop`, file input `+` button → all funnel into a
  shared upload mutation (`use-attachment-upload.ts`, react-query).
- The mutation runs the three-step flow:
  1. `POST /scout/threads/:id/attachments` (mint) → `{ id, uploadUrl, ... }`.
  2. `fetch(uploadUrl, { method: 'PUT', body: file })` direct to S3.
  3. `POST /scout/threads/:id/attachments/:id/commit` → final state.
     Surface a per-step status so the chip can show "uploading" → "processing".
- Post-upload, render `attachment-preview.tsx`: thumbnail (image) or
  filename + page count (PDF), with a remove (×) button.
- `sendMessage` passes `body: { thinkingMode, attachmentIds }`.
- Cap 4 attachments per turn (configurable). Reject visually before
  mint starts when the user exceeds.

For chat history rendering: each message that referenced attachments
fetches signed URLs lazily (use `GET /attachments/:id` per id, cached
by react-query).

## Config additions

```
SCOUT_ATTACHMENT_UPLOADS_BUCKET      # browser-direct uploads (24h lifecycle)
SCOUT_ATTACHMENTS_BUCKET             # permanent attachments bucket
SCOUT_ATTACHMENTS_PREFIX             # default: 'scout/attachments'
SCOUT_ATTACHMENT_MAX_IMAGE_BYTES     # default: 10 * 1024 * 1024
SCOUT_ATTACHMENT_MAX_PDF_BYTES       # default: 10 * 1024 * 1024
SCOUT_ATTACHMENT_DERIVE_MAX_TOKENS   # default: 1500 (covers PDF transcribe + summary)
SCOUT_ATTACHMENT_DERIVED_TEXT_MAX_BYTES  # default: 256000 (250KB sanity cap)
SCOUT_ATTACHMENT_UPLOAD_URL_EXPIRY_SECONDS  # default: 900 (15min)
```

`s3-documents.ts` uses dedicated uploads + permanent buckets per
feature; we follow the same pattern. (Sharing one uploads bucket
across features is feasible with prefix-namespacing but muddies
lifecycle/CORS policies.)

Reuse `SCOUT_MODEL_SUBAGENT` (already Haiku) for the deriver — don't
add a fourth model-id config var. Three Haiku aliases is two too many
and just creates surface area for misconfiguration.

Existing `ANTHROPIC_API_KEY` already gates Haiku access; the upload
route adds its own 503 guard (independent of `SCOUT_PROVIDER_CHAT`)
since image attachments need Haiku regardless of the chat provider.

## Terraform

Two new S3 buckets + IAM policy, mirroring the `s3-documents.ts`
two-bucket pattern:

**Uploads bucket** (`SCOUT_ATTACHMENT_UPLOADS_BUCKET`):

- Public access block, server-side encryption.
- **CORS**: allow `PUT` from the FE origin(s); expose ETag.
- **Lifecycle**: expire objects after 24h. This is the safety net for
  orphaned uploads (mint succeeded, commit never came).
- IAM: ECS task role gets `PutObject` (for presigning), `GetObject`,
  `HeadObject`, `DeleteObject` on this bucket.

**Permanent attachments bucket** (`SCOUT_ATTACHMENTS_BUCKET`):

- Public access block, server-side encryption.
- **No lifecycle expiry** — object lifetime tracks thread lifetime via
  `ON DELETE CASCADE`. We tolerate orphaned bytes from a deleted
  thread (Track 1 is admin/official-only, low volume); a reaping job
  is a future enhancement.
- IAM: ECS task role gets `PutObject` (CopyObject target), `GetObject`,
  `DeleteObject`.

Both bucket+IAM blocks go in `infra/modules/api/` alongside the
existing `scout_reports` and `documents` setups.

## Tests

- `attachments/service.test.ts` — unit, hoisted DB mock per
  `write-tests` skill. Covers cache hit, cache miss, Haiku failure,
  size cap rejection, derived-text truncation.
- `attachments/integration.test.ts` — testcontainers Postgres. Covers
  end-to-end upload → derive → fetch, including hash dedup.
- `routes` integration extension: posting a chat message with
  `attachmentIds` causes the derived text to be appended to the user
  turn (assert via a streamText fake).

## Sequencing

1. Migration + Kysely codegen (`pnpm run db:types`).
2. Terraform: two buckets (uploads + permanent), CORS on uploads,
   IAM updates. CI applies on merge — order matters because the API
   needs the bucket names at boot.
3. `s3-scout-attachments.ts` (presign + head + get + copy + delete) +
   `app.ts` decoration.
4. Derive service (Haiku image + PDF, single module — unit-tested in isolation).
5. Attachments service + integration tests (mint + commit logic,
   cache hit/miss, failure paths).
6. Routes (mint, commit, get, delete + Zod schemas + OpenAPI
   regeneration).
7. Chat turn integration in `routes.ts` POST messages handler
   (`attachmentIds` → `<chat-attachments>` block, after
   `applyAutoRetrieval`).
8. Frontend composer + preview (3-step upload flow).
9. Manual smoke: paste an opposition team sheet, verify caption shows
   in chat, agent uses it in answers; force a commit failure to
   confirm the FE error chip path.

## Open items / things to flag

- **Anthropic dependency hardening**: chat is on DeepSeek but Haiku is
  now on the chat-time hot path for both image and PDF attachments.
  If `ANTHROPIC_API_KEY` is missing, attachment uploads must fail fast
  with a user-visible message — not silently fall back to "no
  derived text available".
- **Cleanup**: thread deletion cascades the DB row but does NOT delete
  the S3 object (no S3 lifecycle, no on-delete hook yet). Tolerated for
  v1 — Scout is admin/official only, low volume. Future enhancement: a
  scout_thread `ON DELETE` trigger that enqueues object-key deletes.
- **Re-render of historical threads**: signed URL expiry is 30 min; a
  user scrolling back through a long thread will refetch — fine.
- **Multi-attachment turn UX**: confirm 4 is the right cap; agents do
  better with focused context.
