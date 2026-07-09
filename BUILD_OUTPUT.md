# Build log: content assistant edit ops + sidebar (overnight run, 2026-07-09)

Branch: `feat/content-ai-edit-ops-sidebar`. Plan approved before you went to bed;
this file records the judgement calls I made where the plan left room, how to
reverse each one, and what I verified. ADR 055 covers the architecture proper.

## Screenshots

E2E screenshots for morning review are in `/tmp/content-ai-screenshots/`
(numbered in walkthrough order, README.txt inside describes each).

## Decisions made under uncertainty

1. **`update` op keeps omitted fields** (BlockNote `updateBlock` partial
   semantics) rather than wholesale replacement. This lets the agent change a
   heading level or block type without destroying the block's formatted text,
   which softens the plain-text-rewrite trade-off. The tool description and
   system prompt teach this explicitly.
   _To change:_ make the client pass `content: ""`/explicit fields in
   `applyEditOps` (apps/web `content-ai/apply-edit-ops.ts`) and reword the
   tool description in `tools/edit-content.ts`.

2. **Image blocks: updates rejected server-side, deletes allowed.** The agent
   cannot re-create image bytes, so rewriting a `contentImage`/`photoGallery`
   is blocked in the draft session (error receipt tells the model deletes are
   for explicit user requests only; the prompt repeats it). Deletes stay
   allowed because "remove that photo" is a legitimate ask and Cmd+Z exists.
   _To change:_ the `agentWritable` check in `draft-session.ts` (`apply` ->
   update branch).

3. **Projection caps: 500 top-level blocks / 100 children / 8k chars per
   block**, truncating the tail rather than failing the request. Real drafts
   are far smaller; the caps only guard the request schema. Truncation is
   silent to the agent - if giant pages become normal, revisit.
   _To change:_ constants at the top of `content-ai/draft-projection.ts` and
   the mirrored caps in `draftBlockSchema` (shared block-catalog.ts).

4. **Table `columnWidths` are projected and accepted back**, so an agent that
   echoes them preserves table layout on rewrite. Cell styling still resets
   (string cells only) - documented in the tool description.

5. **Old "Generate with AI" header button removed entirely** rather than kept
   as a shortcut that flips the tab - one entry point, less header clutter.
   _To change:_ re-add a small button in the `LoadedEditor` header that calls
   the same `?panel=assistant` param write `EditorSidebar.onPanelChange` does.

6. **Details tab also `forceMount`ed** (hidden, not unmounted) so any local
   state in HistoryCard etc. survives tab flips; the chat panel is the one
   that strictly needs it.

7. **Tab param name is `panel`** (`?panel=assistant`), pushed (not replaced)
   into history to match the admin section/sub convention; cleared by
   `content-tab.tsx` when the editor closes. Deep link works:
   `?section=content&sub=news&item=<id>&panel=assistant`.

8. **Commit C+D merged into one commit** (the modal->panel file rename spans
   both), so every commit on the branch still builds/tests green.

9. **`hidden` attribute + display classes:** the forceMount tabpanel relies on
   the HTML `hidden` attribute; flex/height utilities live on an inner wrapper
   div so a display utility can never override the hidden state (Tailwind
   preflight ordering).

## Known trade-offs (accepted for v1, flagged in ADR 055)

- Rewriting a block's `content` drops that block's inline bold/italic/links.
  Mitigated by the `[has formatting]` markers in the draft listing, the prompt
  rules, and the omitted-fields update semantics above. Proper fix (rich
  inline content in the write schema) is deferred; the op protocol is
  forward-compatible.
- Draft snapshot is per-send: user edits mid-turn can strand an op; the client
  skips stale-id ops silently (count returned but not yet surfaced in the UI)
  and the next send resyncs.
- Chat resets when the editor closes or the page reloads (route stays
  stateless, per ADR 049). It now survives tab switches - that was the bug.

## Verification done

- Unit: 20 shared schema tests, 32 API tests (draft session, both tools,
  agent/prompt), 13 web tests (projection, op application) - all green.
- `pnpm lint`, `pnpm test`, `pnpm build`, react-doctor (diff scan clean)
  across the monorepo.
- Local E2E against the dev stack with real DeepSeek agent turns (screenshots
  in /tmp/content-ai-screenshots/, README.txt inside): tabbed sidebar renders;
  ?panel=assistant tracks the tab and deep-links; a three-part request
  produced one edit_content call (heading inserted at top + paragraph
  rewritten in place, first paragraph untouched) and one write_content append;
  a follow-up turn deleted the block the agent had added in the PREVIOUS turn
  (server-assigned ids stay stable across turns); the conversation survived
  Details<->Assistant tab switches; Cmd+Z undid an agent delete.

## Heads-up: I restarted your dev servers

Both long-running local dev processes were stale and effectively broken:
vite (port 5173) was serving "504 Outdated Optimize Dep" after the recent
dependency bumps, and the tsx API watcher (port 3000) was not picking up new
source at all (first E2E turn ran the OLD agent code - it saw an empty draft
because the old schema strips `blocks`). I killed both and started fresh ones
in the background; they die with my session, so run `pnpm dev` as usual.
