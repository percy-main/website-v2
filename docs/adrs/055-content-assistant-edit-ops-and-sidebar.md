# ADR 055: Content assistant edits via a server-validated op protocol, in a persistent sidebar

## Status

Accepted (extends ADR 049)

## Context

The ADR 049 assistant could only append blocks to the end of the draft and never saw the draft's actual content (only a list of block types), so "rewrite the intro" or "delete the last section" were impossible. It also lived in a modal: closing it to look at the content it had just written destroyed the whole conversation, and it could not be read side-by-side with the canvas.

Two constraints shape the design. First, the draft lives client-side in the BlockNote editor (unsaved changes included), so the server never has an authoritative copy: whatever the agent sees must be shipped with each request. Second, the route is stateless by design (ADR 049) and we did not want to give that up for a per-draft helper.

## Decision

1. **The client ships a plain-text projection of the live document with every turn.** `projectDraftBlocks` (apps/web `content-ai/draft-projection.ts`) maps `editor.document` to `{ id, type, content: string|tableContent, props, hasFormatting?, children? }` per block: inline content flattened via the public renderer's `inlineToText`, default styling props dropped, image-pipeline payloads (`picture`, `images`, `src`) stripped to captions, and blocks whose flattening lost marks/links tagged `hasFormatting`. The system prompt renders this as a numbered, indented listing with ids.
2. **A new `edit_content` tool speaks an op protocol.** Ops are a flat discriminated union in the shared block catalog: `insert` (at start/end/before/after + `refBlockId`), `update` (blockId + replacement block, validated by the existing `writeContentBlockSchema`), `delete` (blockIds). Resolved ops stream to the client as `data-content-ops` parts (the `chart_render`/`write_content` pattern); the client applies them with `insertBlocks`/`updateBlock`/`removeBlocks`.
3. **A per-request draft session validates everything server-side.** `createDraftSession` mirrors the projected draft as an id/type/nesting tree, shared by `write_content` and `edit_content`. It assigns fresh UUIDs to every block the agent adds (BlockNote honours `PartialBlock.id`), so receipts give the model real, targetable ids; it rejects unknown ids, positionless relative inserts, and updates that target non-agent-writable (image) blocks, with recovery-oriented error receipts. Op batches are all-or-nothing: simulated on a working copy, committed only if every op passes.
4. **The client applies op batches all-or-nothing after a stale-id preflight.** The user may edit (or restore a revision) mid-stream, so `applyEditOps` checks every id a batch references and drops the whole batch if any is stale - applying half of it could pair a skipped insert with a destructive delete. Dropped batches are flagged in the chat (amber chip) so the user knows to re-ask. The draft is the user's; the agent's view is advisory.
5. **The modal becomes a sidebar tab.** The editor's left column is now Details/Assistant tabs; the active tab lives in the URL (`?panel=assistant`, default omitted) per the admin URL-state convention, and both panels stay mounted (a new `forceMount` on the homegrown `TabsContent`) so the conversation survives tab switches. The chat remains ephemeral across editor open/close - the route stays stateless.

## Options considered

1. **Op protocol + server-side draft session** (chosen).
2. **Full-document replace.** The agent emits the whole new document each time; the client swaps it in with `replaceBlocks(editor.document, ...)`. Simple protocol, but it regenerates every block id (breaking undo granularity and concurrent user edits), forces the model to re-emit content it did not change (token cost + hallucinated drift in untouched sections), and destroys inline formatting everywhere rather than only in edited blocks.
3. **Client-side validation only (no session).** Stream raw ops and let the editor sort it out. Fewer moving parts, but the model gets no feedback: a typo'd block id silently no-ops and the model believes the edit happened. The session turns those into corrective receipts mid-turn.
4. **Client-executed tools (AI SDK client tools).** Would give the model ground-truth results from the real editor, but requires pausing the stream for a client round-trip per call (multi-request turns) - a large transport change to the stateless route for marginal benefit over the mirrored session.
5. **BlockNote's `xl-ai` package.** Ships AI document editing natively, but it owns the whole agent loop (incompatible with our club-data tools/persona) and is GPL-3.0-or-proprietary; licensing is a decision for the club, not this ADR.

## Rationale

- **Shipping the draft per-turn keeps the route stateless** and the server session is rebuilt from it on every request - no new tables, no thread state, same operational surface as ADR 049.
- **Server-assigned ids are what make multi-step editing work.** Without them, blocks appended by `write_content` would be unaddressable until the next user turn; with them, "append then refine" happens within one agent turn.
- **All-or-nothing batches keep the two mirrors consistent.** If op 3 of 4 fails and ops 1-2 had applied, the session and the editor would disagree for the rest of the turn.
- **Formatting loss is contained, not eliminated.** Plain-string content (ADR 049's flat write schema) means rewriting a block drops its bold/links. Mitigations: `hasFormatting` markers + prompt rules steer the model away from those blocks, and BlockNote's partial-update semantics (omitted fields are kept) let the model change type/props without touching text at all.

## Rejected alternatives

- **Full-document replace** - rejected for id churn, token waste and formatting destruction. Would become attractive only if the protocol grew unmanageably.
- **No server validation** - rejected; silent no-ops are worse than errors the model can react to.
- **Client-executed tools** - rejected for transport complexity; revisit if the mirrored session ever drifts from real editor behaviour in practice.
- **`xl-ai`** - not pursued; licensing is Alex's call and the custom agent tooling is the product's value.
- **Rich inline content in updates** (emitting styled text arrays) - deferred; it would fix formatting loss properly but roughly doubles the write-schema surface the model must drive. The op protocol is forward-compatible with it (only the `content` shape would widen).

## Related

- ADR 049 - the assistant this extends (tool reuse, streaming pattern, block catalog, statelessness).
- `packages/shared/src/content/block-catalog.ts` - draft projection + edit op schemas.
- `apps/api/src/features/content-author/draft-session.ts` - the per-request mirror + validation.
- `apps/web/src/pages/admin/content-ai/` - projection, op application, sidebar panel.
