# ADR 049: AI content-author assistant reuses Scout's tools and streams blocks into the editor

## Status

Accepted

## Context

Authoring rich content in the BlockNote editor (ADR 047) - match reports, news, event pages - is entirely manual. We want a chat assistant, opened from a "Generate with AI" button on the editor page, that researches the club's own data and writes finished content blocks straight into the draft.

The requirements: the agent must use the existing Scout data tools (Play Cricket, ball-by-ball, the database), gain one new `write_content` tool that appends BlockNote blocks to the live editor, be seeded with the editor's metadata (e.g. a match report's `playCricketId`) to guide research, run with reasoning on, be able to emit any content block type (including ones added later), and always write in a positive, club-promoting tone that never calls out individual players' mistakes.

Scout (`apps/api/src/features/scout/`) already provides almost all the machinery: a Vercel AI SDK v6 agent loop, those exact data tools as self-contained curried factories, multi-provider model resolution (`resolveModel`), SSE streaming via `createUIMessageStream`, and the "client tool streams a `data-*` part -> frontend renders it" pattern used by `chart_render`.

## Decision

A new `content-author` feature that assembles an agent from Scout's tool factories plus a new `write_content` tool, behind a single stateless streaming route.

1. **Reuse, don't re-mode.** `createContentAuthorAgent` imports `createPlayCricketTools`, `createDbTools`, `createWeatherTools`, `createScoutCache`, `resolveModel`, and the read-only `fact_retrieve` from `createFactTools`, all from `../scout/*` directly. It shares Scout's `scout_readonly` DB surface, which is intentionally curated to be safe for AI access on this single-tenant, trusted-user deployment. Scout is not modified beyond one allowlist entry. The system prompt requires everything written to be grounded in tool/fact results (never invented) and forbids em dashes.
2. **`write_content` is a client tool.** It validates blocks against a shared catalog, streams a `data-content-blocks` part, and returns a short receipt to the model. The editor modal appends the blocks via `editor.insertBlocks(...)`, deduping by part id. This is exactly the `chart_render` shape - the agent produces data, the client renders (here, appends) it.
3. **Shared block catalog as the single source of truth.** `packages/shared/src/content/block-catalog.ts` describes every block type (LLM-facing description, props Zod schema, content kind, agent-writable flag). It drives both the `write_content` input validation and the system-prompt block reference. A sync test asserts every `CUSTOM_BLOCK_TYPES` value has an entry.
4. **Stateless / ephemeral chat.** No thread persistence: `useChat` holds the conversation while the modal is open and discards it on close. The route casts `messages` from the client each turn.
5. **Reasoning always on**, wired per provider (DeepSeek `thinking: enabled`; Anthropic extended thinking with a budget under `maxOutputTokens`).
6. **`content_item` added to the Scout DB allowlist** (+ a `GRANT SELECT ... TO scout_readonly` migration) so the agent can resolve real records for `person` / `personGrid` / `eventPreview` blocks.

## Options considered

1. **New feature reusing Scout's tool factories** (chosen). Lowest coupling change to Scout; clear separation of the analyst persona (tactical, calls out dismissals) from the author persona (positive, never blames). Ephemeral and stateless.
2. **A new Scout "mode".** Scout already has `chat` / `scout` / `debrief` modes. But Scout's route is thread-persisted with attachments, facts, KB and sharing - all irrelevant here - and its system prompts and tone are the opposite of what content authoring needs. Bending that route to a stateless, tone-inverted use would entangle two products.
3. **Agent returns markdown the user pastes.** Loses every custom block (game previews, wagon wheels, league tables), which are the whole point of rich club content, and adds a manual paste step.
4. **Persisted author threads per content item.** Real DB + CRUD scope for a per-draft helper users will mostly run once. Deferred.

## Rationale

- **The client-tool streaming pattern already exists and fits exactly.** `write_content` differs from `chart_render` only in what the client does with the streamed data part (append blocks vs render a chart), so we inherit a proven transport.
- **A shared catalog keeps "any block type, including new ones" honest.** The editor's React block specs can't move to `packages/shared` (they need components), so the catalog mirrors their props; the sync test guards type coverage so a newly added editor block can't silently fall out of the agent's vocabulary.
- **Stateless is the simplest thing that works** for a modal helper and avoids new tables.
- **Tone and grounding are prompt-level**, not structural: the system prompt forbids highlighting individual failures (ducks, dismissals, dropped catches) and frames defeats collectively, while reusing Scout's anti-hallucination grounding.

## Rejected alternatives

- **Scout mode** - rejected to keep the analyst and author personas, and the persisted vs ephemeral transports, cleanly separated. Revisit only if the two converge.
- **Markdown output** - rejected; it cannot express the custom blocks that make club pages rich.
- **Persisted threads** - rejected as unjustified scope now; the natural escape hatch if users want to resume conversations.
- **Recursive (nested-children) block authoring** - dropped for v1: a flat block list covers all current needs and avoids shipping a self-referential JSON schema to the model as the tool input.
- **Bespoke `content_lookup` tool** - rejected in favour of granting `db_run_sql` read access to `content_item`; the agent already writes SQL, so a dedicated tool was redundant.

## Related

- ADR 047 - content editor (BlockNote), the feature this assistant authors into.
- `apps/api/src/features/content-author/` - agent, `write_content` tool, system prompt, stateless route.
- `packages/shared/src/content/block-catalog.ts` - the shared block catalog + `write_content` schema.
- `apps/web/src/pages/admin/content-ai/` - the modal + chat hook; `ContentAiLauncher` in `content-editor.tsx`.
- `apps/api/src/features/scout/tools/db.ts` + migration `2026-06-14T20:11:43.924Z.ts` - `content_item` read access for `scout_readonly`.
