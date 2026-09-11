# Decision 062: Expose a subset of Scout as an MCP server

**Date:** 2026-09-11
**Status:** Accepted

## Decision

Add a new `apps/api/src/features/mcp/` feature that re-registers a curated
subset of Scout's existing tool functions (`features/scout/tools/*`) as MCP
(Model Context Protocol) tools, so members can query club data from their
own MCP-capable chat client (Claude Code, Claude Desktop, Cursor, etc.)
instead of only through the Scout panel on the website. The MCP surface does
**not** wrap Scout's `streamText` agent loop — an MCP client's own model is
the orchestrator, so exposure is a set of discrete tool functions, not a
conversation.

Four sub-decisions, each detailed below: the SDK package, a new (stricter)
DB boundary distinct from Scout's, the auth mechanism, and which tools are
in scope.

- **Package:** official `@modelcontextprotocol/server` + `/node` + `/fastify`
  (v2, spec `2026-07-28`), registered as thin Fastify routes on the existing
  `apps/api` instance.
- **DB boundary:** a new `mcp_readonly` role and `member_public` view
  (`id`, `name` only), not a reuse of Scout's `scout_readonly` role /
  `scout_member` view (which includes `dob`).
- **Auth:** OAuth 2.1 via `@better-auth/mcp`, turning the existing
  better-auth instance into an authorization server. Classic Dynamic Client
  Registration enabled now; CIMD (Client ID Metadata Documents) deliberately
  not adopted yet.
- **Tool scope:** club-data reads (DB query tools, Play Cricket lookups,
  weather) plus two personalized tools, `open_availability_requests` and
  `confirm_availability`, that call existing `features/availability/
  service.ts` functions rather than raw SQL. No knowledge-base/facts tools,
  no report generation, no face recognition, no other writes.

## Problem

Scout (`features/scout/`) already has real tool logic against club data —
Play Cricket stats, DB queries, KB/fact search — but it's only reachable
through the website's own chat panel, and that panel is gated behind an
admin-granted permission (`ai_chat:use` via `requirePermission` in
`features/scout/routes.ts`). There was no way for a member to use their own
preferred AI client against this data.

The naive approach — stand up an MCP server that thinly wraps the existing
tool factories and existing DB roles as-is — doesn't work, because MCP
changes who the audience is. Anyone can sign up to percymain.org, and the
intent is that any signed-up member can use MCP, not just the small,
admin-vetted set of people who've been granted `ai_chat:use` today. Scout's
existing tool surface and DB grants were designed for that narrower,
admin-vetted audience (e.g. `scout_member` includes `dob`) — reusing them
verbatim for a self-serve-signup audience would leak more than intended.

## Options considered

**MCP server package:** official modular `@modelcontextprotocol/*` v2 vs.
`mcp-framework` vs. `fastmcp` vs. the community `fastify-mcp-server` wrapper.

**DB access boundary:** reuse `scout_readonly`/`scout_member` as-is vs. a
new, narrower role and view.

**Auth:** static per-user API keys (`@better-auth/api-key`) vs. a full OAuth
2.1 authorization server (`@better-auth/mcp`) vs. hand-rolling OAuth.

**Tool scope:** mirror Scout's full tool list vs. a curated read-mostly
subset.

## Rationale

**Package.** `mcp-framework` and `fastmcp` each own their own HTTP server,
which fights this codebase's Fastify-instance-owns-everything pattern
(`app.db`, `app.config` decorations, per ADR 009). The community
`fastify-mcp-server` wrapper is reasonable, but the official
`@modelcontextprotocol/fastify` package's own README example is nearly the
same amount of glue code (`createMcpFastifyApp`, a `POST /mcp` handler
around `NodeStreamableHTTPServerTransport`), so a third-party dependency
buys nothing here. The official v2 packages are Anthropic-maintained,
current against the `2026-07-28` spec, and match this repo's stack.

Each MCP tool call here is a single DB query or one cached Play Cricket
read — sub-second to low-seconds, unlike a full Scout chat turn (`streamText`
up to `SCOUT_MAX_STEPS=20`, which can run for minutes). This matters beyond
UX: ADR 061 is mid-flight, moving `apps/api` from the ALB to an API Gateway
HTTP API, and its route audit found Scout's own streamed chat endpoint is
one of exactly two routes that structurally block that cutover (HTTP API
buffers/caps responses at ~30s). Building `/mcp` as one-shot
request/response (`sessionIdGenerator: undefined`, no persistent SSE held
open) keeps it off that blocker list entirely, on either ALB or API Gateway.

**DB boundary.** Scout's `scout_readonly` role and `scout_member` view
(migration `2026-05-03T11:58:39.382Z`, and the least-privilege pattern
established in ADR 043) are the right shape for Scout's admin-vetted
audience, but `scout_member` selects `dob`, which is not acceptable for
"anyone who signs up." Rather than special-case columns inside the existing
view per caller, MCP gets its own role (`mcp_readonly`) and its own view
(`member_public`), checked directly against the `member` table schema
(baseline migration `0001_baseline.ts:102-120`): only `id` and `name` are
exposed. Every contact field (`address`, `postcode`, `telephone`, `email`,
both emergency-contact columns), `dob`, both external identifiers
(`stripe_customer_id`, `play_cricket_id`), and the membership-metadata
columns (`member_category`, `slug`) are excluded. `availability_*` tables
are not in the `mcp_readonly` grant at all — that data reaches MCP only
through the two personalized tools below, which apply the same scoping the
matchday PWA already relies on.

**Auth.** The original plan (static per-user API keys via
`@better-auth/api-key`) assumed a small, roughly-trusted set of users
generating long-lived personal tokens — reasonable for an admin-vetted
audience, less so once "anyone with an email address" is in scope.
`@better-auth/mcp` turns the existing better-auth instance into a real
OAuth 2.1 authorization server for MCP clients (RFC 9728 + RFC 8414
discovery; `jwt()` plugin provides the JWKS signing keys), so every MCP
session traces back to a real login plus an explicit consent screen, and
tokens are short-lived and scoped rather than a static secret sitting in a
client config file. This also turned out to be necessary, not just nicer:
the two personalized tools (below) need to know *which specific member* is
calling, which a shared static token can't express but a per-user OAuth
grant does for free.

Resource-server verification uses `requireMcpAuth`, which validates the
bearer token against the AS's JWKS and enforces `requiredScopes` (a new
`mcp:use` permission via the existing `ac`/`roles` system, intended to be
default-granted to the base member role — separate from `ai_chat:use` so
the two audiences can be managed independently). One implementation detail
worth flagging for whoever builds this: `requireMcpAuth` hands back verified
JWT claims (the `sub` = better-auth user id), not a mocked session the way
the `api-key` plugin's session-injection does — the two personalized tools
below need one extra `sub → user → email` lookup that the existing REST
availability routes get for free via `getAuthSession(request).user.email`.

Classic Dynamic Client Registration (`allowDynamicClientRegistration: true`,
`allowUnauthenticatedClientRegistration: true`) is enabled now. `@better-auth/
cimd` — the newer Client ID Metadata Document mechanism the `2026-07-28`
spec revision introduces to eventually replace DCR — is deliberately not
adopted yet: it's a separate optional package, and there's no current data
on which MCP clients (Claude Desktop, Claude Code, Cursor, Claude.ai) have
actually shipped CIMD support. Revisit once that's known rather than
guessing now.

**Tool scope.** Exposed: `db_list_tables`/`db_describe_table`/`db_run_sql`
(against `mcp_readonly`), the Play Cricket read tools, `weather_get`/
`weather_geocode`, and two personalized tools — `open_availability_requests`
and `confirm_availability` — that re-register `getActiveRequests`/`respond`
from `features/availability/service.ts` unchanged (the same functions the
matchday PWA's own routes call). `confirm_availability` is a deliberate,
narrow exception to an otherwise read-only surface: it's a fixed,
already-reviewed, identity-scoped write (a member confirming their own
availability), not an open-ended one, so it doesn't carry the same risk as
the excluded write tools.

Excluded: `knowledge_search`/`fact_retrieve` (semantic search over
`scout_kb_document`/`scout_kb_chunk`/`scout_fact` — corpora admins wrote
into assuming Scout's narrower, admin-gated audience; excluded outright
rather than gated on a one-time content audit), the UI-plumbing tools
(`chart_render`, `cite_*`, `render_image`, `render_video`, `player_faces`,
`ask_question` — take a `UIMessageStreamWriter` and push parts into Scout's
own web panel, meaningless to a generic MCP caller), `generate_report`/
`fact_record` (open-ended writes with real cost — async PDF jobs, paid
embedding calls), and `find_player_photo_sources` (Tavily + AWS Rekognition
face detection, privacy-sensitive per ADR 042 and not even wired into the
live agent today — should never reach a self-serve-signup audience).

## Rejected alternatives

- **Wrapping Scout's full agent loop behind MCP**, so an MCP client could
  have a whole Scout conversation. Rejected — MCP tools are called by the
  *client's* model; making our own model an intermediary adds cost, latency,
  and the exact multi-minute streaming shape ADR 061 is trying to get away
  from, for no benefit over exposing the underlying tools directly.
- **`mcp-framework` / `fastmcp`** — see Rationale; both own their HTTP
  stack, incompatible with this repo's single-Fastify-instance pattern
  without real friction.
- **Community `fastify-mcp-server` wrapper** — solid design, but redundant
  given the official Fastify adapter covers the same glue directly.
- **Reusing `scout_readonly`/`scout_member` for MCP** — the whole point of
  this decision is that Scout's boundary was sized for a different
  audience; reusing it would either leak `dob` or require bolting
  per-caller column filtering onto an existing view used elsewhere.
  Revisit only if Scout's own access model changes (e.g. `ai_chat:use`
  becomes default-granted too, collapsing the two audiences into one).
- **Static per-user API keys (`@better-auth/api-key`)** — viable, and
  clearly right-sized for a small admin-vetted audience of the kind Scout's
  own chat panel has. Rejected here specifically because of the "anyone can
  sign up" audience and because the personalized availability tools need
  real per-user identity that a shared static token can't provide as
  cleanly as an OAuth grant tied to a specific login. Would become
  attractive again if the audience were narrowed back down, or if the
  personalized tools were dropped.
- **Adopting `@better-auth/cimd` now** — premature without data on client
  support; classic DCR is well-understood and the plugin supports both, so
  there's no cost to deferring.
- **Exposing `availability_*` tables via `mcp_readonly` (raw SQL) instead of
  dedicated tools** — would require re-deriving the group-membership/
  dependent scoping that `getActiveRequests`/`respond` already implement
  correctly, duplicating logic and risking a scoping bug in a second place.
  The two dedicated tools reuse that logic as-is.
- **Auditing and then shipping `knowledge_search`/`fact_retrieve` on MCP** —
  considered, but excluding them outright is simpler than a recurring
  content-hygiene obligation on two tools of secondary value to this
  surface. Revisit if there's real demand and someone owns the audit.

## Related

- ADR 042 — Scout recognition sources (why `find_player_photo_sources` is
  privacy-sensitive and excluded here too).
- ADR 043 — DB role split / least privilege (the precedent this follows for
  `mcp_readonly`).
- ADR 061 — ALB → API Gateway HTTP API (the streaming/timeout constraint
  that shapes MCP's transport as one-shot request/response).
- Design notes: `.local/MCP.md` (gitignored working doc, superseded in
  detail by this ADR but kept as scratch context).
