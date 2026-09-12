# Decision 063: Dedicated custom domain for the MCP server

**Date:** 2026-09-12
**Status:** Accepted

## Decision

The MCP server (ADR 062) moves from `https://api.v2.percymain.org/mcp` to
`https://mcp.percymain.org/mcp` in production. The `/mcp` path is kept
(the resource is not the bare domain root). It attaches to the existing
ALB as an additional SNI certificate, not to API Gateway. The protected-
resource identifier is decoupled from `API_BASE_URL` into its own config
value, `MCP_BASE_URL` — placeholder-tolerant like `MATCHDAY_URL`/`WWW_URL`,
not hard-required like `API_BASE_URL`, with the MCP feature disabling
itself gracefully (a 503, not a crash) whenever it's unset. Staging keeps
MCP on its current hostname unchanged.

## Problem

`https://api.v2.percymain.org/mcp` works end-to-end (DCR, authorize,
consent, token exchange, tool calls all verified against ChatGPT's
connector) but reads as a path bolted onto the general marketing API
domain, which is worse DX for MCP client configs (Claude Desktop/Code,
ChatGPT connectors) than a domain that signals what it's for. This is a
cosmetic/DX change on top of a working feature — none of ADR 062's
decisions are revisited here.

Three things made this less mechanical than "add a CNAME":

1. ADR 061 (ALB → API Gateway) is mid-migration and had not flipped
   `api.v2.percymain.org` off the ALB at the time this was picked up —
   API Gateway only serves a test hostname. The new domain has to attach
   to whichever thing is actually serving production traffic today, not
   to the eventual target.
2. `apps/api/src/features/mcp/routes.ts` independently recomputed the
   resource identifier (`${API_BASE_URL}/mcp`) rather than importing it
   from `features/auth/auth.ts`, which sets the same value on the `mcp()`
   plugin. A domain change touching only the documented location
   (auth.ts) would have left `requireMcpAuth`'s audience check and the
   token's minted `aud` claim disagreeing, breaking every MCP call.
3. A brand-new required config value backed by a Terraform-managed SSM
   parameter has a first-deploy race in this repo's pipeline:
   `terraform-production` and `deploy-api` run back-to-back in the same
   CI run with no gate for an operator to set the real value in between
   (`deploy.yml`'s `deploy-api` job only depends on `terraform-production`
   succeeding). Terraform seeds the new parameter with a literal
   `"placeholder"` string. A hard `z.url()` schema (the initial version of
   this change used one, matching `API_BASE_URL`) rejects that string,
   crashing every task on boot and triggering ECS's deployment circuit
   breaker — not just failing to deploy MCP, but rolling back the _entire_
   API deployment over one unrelated config value. Caught by CodeRabbit's
   review of the PR, not found during initial implementation.

## Options considered

1. **New SNI cert on the existing ALB, `/mcp` path kept (chosen).** DNS +
   ACM cert + an `aws_lb_listener_certificate` addition to the current
   HTTPS listener. Zero ALB routing-rule changes, because the listener
   already has a single default action forwarding every request to the
   one target group regardless of Host header — this was true before
   this change and remains true after.
2. **Bare domain root (`https://mcp.percymain.org`, no path).** Would
   need either an ALB host-header listener rule that rewrites the path,
   or a Fastify hook that dispatches on `request.hostname`. Real added
   surface (new routing logic, another thing that can silently drift)
   for a cosmetic change whose actual ask was a dedicated domain, not
   path removal.
3. **Add `mcp.percymain.org` as a SAN on the shared ALB cert**
   (`infra/environments/shared/main.tf`'s `aws_acm_certificate.alb`).
   Rejected: that cert is also staging's ALB listener default cert and
   the domain name API Gateway's VPC Link verifies
   (`backend_tls_server_name`, ADR 061). Modifying its SAN list forces a
   replacement certificate and re-validation for something unrelated to
   MCP, and widens the blast radius of this change onto two systems that
   don't need to move.
4. **Attach the new domain to API Gateway instead of the ALB.** Rejected
   for now: API Gateway hasn't taken any production traffic yet (ADR 061
   is still in its stand-up/verification phase). Routing a live,
   already-working feature onto the unverified path first — before even
   `api.v2` itself has flipped — would couple this change's risk to an
   unrelated in-flight migration.
5. **Keep `mcpResource` derived from `API_BASE_URL`.** Rejected: the
   whole point is a different hostname for MCP than the general API, so
   the two values need to be independently configurable. Introduced
   `MCP_BASE_URL` as its own config value instead, and extracted a single
   `getMcpResource()` helper (exported from `auth.ts`) so `auth.ts` and
   `mcp/routes.ts` can no longer independently drift on what the resource
   identifier is.
6. **A CI/CD deployment gate**, splitting `terraform-production` and
   `deploy-api` so an operator can set the real `MCP_BASE_URL` value in
   between (CodeRabbit's suggested fix for problem 3 above). Rejected as
   disproportionate: it changes a general pipeline invariant that every
   other secret/parameter in this repo relies on, for one new value, and
   this repo already has a proven, much smaller-footprint answer to
   exactly this bootstrap race (below).
7. **Placeholder-tolerant `MCP_BASE_URL` + graceful feature disable
   (chosen).** `config.ts`'s existing `optionalPlaceholderUrl` transform
   (already used by `MATCHDAY_URL`/`WWW_URL`, introduced for the same
   reason: treats a Terraform-seeded `"placeholder"` value as unset)
   applied to `MCP_BASE_URL`, with `auth.ts` skipping the `mcp()` plugin
   registration and `mcp/routes.ts` returning a 503 whenever
   `getMcpResource()` returns `undefined`. The deploy that first
   introduces the parameter (or any deploy before an operator sets the
   real value) boots the whole API fine; only `/mcp` itself is
   unavailable until the value is set and the service redeploys.

## Rationale

The ALB already fronts every hostname it's given a cert for — SNI
certificates are additive, and the listener's one default action doesn't
branch on Host — so the lowest-risk path is to give `mcp.percymain.org`
its own cert and DNS records with no other infrastructure change. This
mirrors exactly how `api.v2.percymain.org` itself is already set up
(Route 53 A/AAAA aliases to the ALB, no manual Netlify step), which is
precedent already proven to work.

Keeping `/mcp` as the path avoids introducing Host-based dispatch — either
at the ALB or in Fastify — for a change whose actual requirement was
"give this its own domain," not "make the domain the whole route." The
dedicated cert (rather than extending the shared one) keeps this change
isolated to production and to MCP: staging's ALB and API Gateway's VPC
Link certificate verification are provably untouched, since neither
references the new cert resource.

`requireMcpAuth`'s audience check is an exact string match against the
`resource` passed to it (confirmed against the current better-auth docs,
which state the resource is bound as the token's `aud` claim). That means
the cutover is a hard break for any already-issued token, not a gradual
expiry: the moment the new code deploys, the live ChatGPT connector's
current access token stops matching and the client gets a 401 with a
fresh challenge, requiring one reconnect through the OAuth flow. Accepted
deliberately — this is a single personal connector under direct control,
and MCP clients are expected to follow a 401 challenge by re-running
authorize/consent/token.

`MCP_BASE_URL` mirrors `MATCHDAY_URL`/`WWW_URL`/`COOKIE_DOMAIN` rather than
`API_BASE_URL`/`BASE_URL` for a structural reason, not inconsistency: the
latter two are foundational and have had real values since the service's
very first deploy, so they never faced this race. Every config value
introduced _after_ the service was already live and continuously deployed
— MCP_BASE_URL included — hits the same Terraform-placeholder-seeds-first
race, and this repo's established answer for that specific situation is
the placeholder-tolerant transform plus graceful degradation at the
call site, not a hard-required schema. `getMcpResource()` also trims a
trailing slash before appending `/mcp`, since `z.url()` accepts
`https://mcp.percymain.org/` but that would otherwise produce a
double-slash resource URI (also caught by CodeRabbit's review).

The old `oauthResource` row (`https://api.v2.percymain.org/mcp`) is left
in place rather than migrated or deleted. `resourceSeedMode` is
`insertOnly`, so a new row for the new identifier is inserted alongside it
automatically at boot — no migration needed for that part. Cleaning up the
old row was considered and rejected: `enforcePerClientResources: false`
means resource-to-client linking isn't enforced, so the orphaned row is
inert, matching the same judgement ADR 062 already made about this
setting.

## Rejected alternatives

See Options 2-5 above for the specific reasons each was rejected and what
would have to be true for them to become attractive:

- **Bare domain root**: revisit only if a client integration genuinely
  can't be configured with a path suffix — none observed so far.
- **Shared ALB cert SAN**: revisit if the shared cert's other consumers
  (staging, the API Gateway VPC Link) are ever fully decommissioned, at
  which point the isolation this avoided no longer matters.
- **API Gateway attachment**: revisit once ADR 061's flip PR lands and
  `api.v2.percymain.org` itself is served by API Gateway — at that point
  `mcp.percymain.org` needs its own API Gateway custom domain + Cloud Map
  path added **before** the ALB removal PR deletes the ALB, or MCP goes
  down. Not done now; flagged here so it isn't silently forgotten.
- **Derived `MCP_BASE_URL`**: would become attractive again only if MCP
  were folded back under the general API domain, reversing this decision
  entirely.
- **CI/CD deployment gate**: revisit if this exact race recurs for a third
  or fourth new SSM-backed value — at that point a general gate earns its
  keep across all of them, rather than each one growing its own
  placeholder-tolerance + graceful-disable code.
