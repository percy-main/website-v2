# Decision 061: Replace the ALB with an API Gateway HTTP API (staged)

**Date:** 2026-08-27
**Status:** Accepted

## Decision

The public entry point for the API moves from the Application Load Balancer
to an API Gateway HTTP API: custom domain -> VPC Link -> Cloud Map service
discovery, with the ECS api tasks registered via `service_registries` (SRV
records, so ECS publishes the port attribute `DiscoverInstances` needs).
The change is staged across separate PRs: (1) stand the gateway up alongside
the ALB serving only a test hostname (`api-gw-test.percymain.org`), with the
regional ACM cert already covering `api.v2.percymain.org` as well; (2) after
verification on the test hostname and after the route remediations below,
flip the `api.v2` alias records to the gateway; (3) after a rollback window,
remove the ALB, its listeners, target group, access-logs bucket and the two
public IPv4s. Issue #722 tracks the sequence and stays open until step 3.

## Problem

After the winter cost work (#717-#723) the ALB is the largest remaining
fixed cost: ~$19.83/mo hourly plus ~$7.45/mo for its two public IPv4
addresses, ~$27/mo total, serving near-zero winter traffic. An HTTP API has
no hourly fee and costs ~$1.11 per million requests in eu-west-2, which at
our volume rounds to pennies. But the ALB fronts the exact path Stripe
webhooks and auth ride on, and the two technologies are not equivalent: the
ALB allows 120s idle (raised deliberately for slow image processing, ADR 048) and passes streamed responses through; HTTP APIs have a hard ~30s
integration timeout, buffer responses (no SSE), and cap payloads at 10 MB.
So the swap cannot be a blind cutover - it needs a route audit, a staged
rollout, and remediation of the routes that violate the new constraints.

## Options considered

1. **API Gateway HTTP API via VPC Link + Cloud Map (chosen).** No fixed
   hourly cost, pay-per-request, TLS termination with a regional ACM cert,
   custom domains, CloudWatch access logging and metrics. Constraints: 30s
   hard integration timeout, buffered responses, 10 MB payloads, no WAF
   support.

2. **Keep the ALB.** Zero risk, zero work, keeps 120s timeouts, streaming,
   S3 access logs and the WAF attach point. Keeps paying ~$27/mo for a
   near-idle load balancer, which is the single biggest line on the winter
   bill after the other reductions.

3. **Swap to an NLB.** Cheaper hourly than the ALB but still an hourly fee
   plus LCU charges plus public IPv4s - it removes little of the fixed cost
   and gives up L7 features (no TLS-terminating HTTP routing semantics we
   use today without extra work). Worst of both.

4. **API Gateway REST API.** Supports WAF and (by quota increase) longer
   integration timeouts, but costs ~3x per request, still buffers responses
   (no SSE), needs an NLB or VPC-link-v2 arrangement for private
   integrations, and carries a much larger configuration surface for no
   feature we need.

## Rationale

The fleet is tiny and the traffic is tiny; paying a fixed ~$27/mo for L7
features we barely use is the wrong trade. The HTTP API's per-request
pricing matches the load profile, and its real limitations turned out to be
tractable: the route audit below found exactly two routes that structurally
cannot cross the gateway (the streaming AI chat endpoints) and a small set
of slow inline handlers, all of which have known async remediations - and
several of which are latent bugs behind the ALB anyway (unbounded external
fetches, an 80s default Stripe SDK timeout inside row-locking
transactions). The staged rollout keeps risk near zero: the stand-up PR
moves no traffic, verification happens on a test hostname against the real
backend, the flip is a two-record DNS change with a tested one-commit
rollback, and the ALB is only removed after a clean window.

Cloud Map (rather than pointing the VPC Link at an ALB/NLB listener) is
what removes the load balancer entirely: the gateway discovers task
ENI IP:port pairs directly via `DiscoverInstances`. The Cloud Map service
uses SRV records because ECS only registers the port attribute for SRV
(A-record registration would leave the gateway with IPs and no port). The
Cloud Map namespace and service live in the `ecs-service` module (they
describe how the api tasks are discovered, and the registration is a block
on the ECS service itself); everything gateway-side lives in a new
`api-gateway` module. The gateway module owns its 5xx alarm
(`alarms_sns_topic_arn` input, like `prerender` and `scheduling`), keeping
the module graph acyclic: `monitoring` consumes `ecs-service` outputs, so
the alarm could not live in `monitoring` without `ecs-service ->
api-gateway -> monitoring -> ecs-service` becoming a module-level cycle.

The regional ACM cert is issued from the api-gateway module with both
`api.v2.percymain.org` and the test hostname as subject names, so the flip
PR needs no new cert. ACM issues byte-identical validation CNAMEs for the
same domain in the same account, so the api.v2 validation record duplicates
the one the shared environment manages for the ALB cert; `allow_overwrite`
on both sides makes the doubled management an idempotent UPSERT.

Verified before writing the plan: the aws provider (6.61) applies
`service_registries` changes through `UpdateService` (no `ForceNew` on the
attribute), so registering the live service in Cloud Map is an in-place
update that rolls tasks rather than replacing the service.

## Route-duration audit

Every route was audited against the gateway's constraints (29-30s total
response budget, buffered responses, 10 MB payloads). Verdicts: **blocker**
(structurally cannot cross an HTTP API), **needs async** (plausibly exceeds
~29s inline; must move to a 202 + poll or background pattern before the
flip), **needs hardening** (fine typically, but an unbounded tail can cross
29s; cheap timeout fixes), **fine**.

| Route                                                                      | Worst case / pattern                                                                                                                        | Verdict                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /api/scout/threads/:threadId/messages`                               | Streamed AI chat turn (UIMessageStream over chunked HTTP, up to 20 agent steps + tool calls), 2-15 min                                      | **Blocker** - HTTP APIs buffer responses; needs an async-job + polling transport before the flip |
| `POST /api/content-author/messages`                                        | Same streaming shape and step budget                                                                                                        | **Blocker** - same remediation                                                                   |
| `POST /api/admin/content-images`                                           | Inline sharp ladder on 0.25 vCPU (up to 10 MB source, 6 encodes, 6 sequential S3 puts); 20-60s; produced ALB 504s before ADR 048 trimmed it | **Needs async**                                                                                  |
| `POST /api/profile/edit/photo`                                             | Same `confirmUpload` path                                                                                                                   | **Needs async**                                                                                  |
| `POST /api/scout/threads/:id/attachments/:id/commit`                       | Inline `generateText` (Haiku) over up to 10 MB PDF, no abort signal; 30-120s plausible                                                      | **Needs async**                                                                                  |
| `POST /api/fantasy/admin/calculate-scores`                                 | Sequential per-row upserts (players, then teams x gameweeks); 10-30s+ and grows with league size                                            | **Needs async** (or batched writes)                                                              |
| `POST /api/fantasy/admin/populate-players`                                 | Play Cricket fetch + per-player SELECT/INSERT N+1; 10-60s                                                                                   | **Needs async** (or batched writes)                                                              |
| `POST /api/availability/requests` (auto-notify) and `POST .../notify/send` | Sequential awaited SES + web-push per recipient; club-wide blast 15-60s                                                                     | **Needs async**                                                                                  |
| `POST /api/matchday/:matchId/notify-charges`                               | Same sequential email + push loop                                                                                                           | **Needs async**                                                                                  |
| `POST /api/admin/charge-notification`                                      | Sequential render + SES per unpaid charge; 5-30s                                                                                            | **Needs async** (or batch)                                                                       |
| `POST /api/charges/pay-outstanding`                                        | Sequential Stripe retrieves inside a `forUpdate` transaction; Stripe SDK left on its 80s default timeout; typical <10s                      | **Needs hardening** (Stripe client timeout)                                                      |
| `POST /api/admin/financial-relief/requests/:id/decide`                     | Same Stripe-retrieve loop in a transaction                                                                                                  | **Needs hardening**                                                                              |
| `GET /api/og/game/:matchId`                                                | Play Cricket calls and a sponsor-logo `fetch` with no timeout, then sharp; public + crawler-hit; typical <5s, unbounded tail                | **Needs hardening** (fetch timeouts)                                                             |
| `GET /api/matchday/:matchId/team-news-image`                               | Same pattern, heavier compositing                                                                                                           | **Needs hardening**                                                                              |
| `GET /api/play-cricket/league-table`; `GET /api/games*` cold cache         | Bare `fetch` to Play Cricket, no timeout (TTL cache mitigates)                                                                              | **Needs hardening**                                                                              |
| `GET /api/admin/charges/unpaid-pdf`                                        | `@react-pdf` `renderToBuffer` inline on the event loop; scales with unpaid charges                                                          | **Needs hardening** (worker offload, like scout reports)                                         |
| `POST /api/scout/knowledge/documents/:id/commit`                           | Inline S3 read up to 25 MB + hash (in-VPC, seconds); the ingest itself is already an ECS one-shot task                                      | Fine                                                                                             |
| `POST /api/play-cricket/admin/sync`                                        | 202 + ECS RunTask, launch capped at 10s                                                                                                     | Fine                                                                                             |
| Scout report generation, KB ingest                                         | Offloaded to one-shot ECS tasks; frontend polls                                                                                             | Fine                                                                                             |
| `POST /api/stripe/webhook`                                                 | Signature verify + handler, bounded inline SES; 2-5s                                                                                        | Fine                                                                                             |
| `/api/auth/*` (better-auth)                                                | Hashing + occasional inline SES; 1-3s                                                                                                       | Fine                                                                                             |
| Stripe read routes (payments, membership, members)                         | 1-4 bounded Stripe calls                                                                                                                    | Fine                                                                                             |
| Everything else                                                            | DB-only, sub-second                                                                                                                         | Fine                                                                                             |
| Payloads                                                                   | Fastify `bodyLimit` is the 1 MiB default; responses are buffered JSON/images far below 10 MB; large objects move via presigned S3 URLs      | Fine (10 MB cap not a factor)                                                                    |
| WebSockets / SSE consumers / long-lived idle connections                   | None anywhere beyond the two chat routes above                                                                                              | Fine                                                                                             |

The two blockers gate the flip. The needs-async set would 504 at the
gateway while the work completes server-side (the ADR 048 failure mode);
all are admin/captain surfaces, not member-facing checkout or auth. The
needs-hardening set is tail risk only and each fix is a timeout or an
offload, not an architectural change.

## Staged cutover plan

The full runbook (verification commands, flip PR contents, rollback drill,
removal PR contents) is in the stand-up PR body, linked from #722. In
brief:

1. **Stand-up (this ADR's PR):** gateway + VPC Link + Cloud Map + cert +
   test hostname + access logs + 5xx alarm. `api.v2` DNS, the ALB and the
   Route 53 health check untouched; zero traffic moves.
2. **Verify on `api-gw-test.percymain.org`:** health endpoints, login + 2FA
   cookie flow, a Stripe webhook replay signed with the production signing
   secret (proves the gateway does not alter raw bytes), matchday PWA
   calls, client-IP passthrough, access logs and alarm.
3. **Remediate** the blocker and needs-async routes; land the hardening
   fixes.
4. **Flip PR:** add the `api.v2` custom domain + mapping (cert already
   covers it) and repoint the two alias records from the ALB to the
   gateway. Everything else - webhook URL, auth baseURL, SPA config, the
   health check - keys off the unchanged hostname.
5. **Rollback drill** during the overlap window: revert the alias records
   to the ALB once, verify, re-flip. Alias changes propagate in ~a minute.
6. **Removal PR** after a clean window: ALB + listeners + target group +
   logs bucket + ALB security group + ALB alarms/widgets + shared ALB cert
   (production apply restores the shared validation CNAME the teardown
   deletes). This is where the ~$27/mo lands.

## Losses accepted

- **ALB S3 access logs** (90-day retention) -> API GW access logs to
  CloudWatch, 14-day retention. Verification and triage, not archival.
- **The WAF attach point.** Unused today, and HTTP APIs cannot attach WAF
  at all. If WAF ever becomes necessary the options are CloudFront in
  front or a REST API.
- **Target-group health-check alarms** (unhealthy hosts, rejected
  connections, connection errors, p99 latency) -> the gateway 5xx alarm
  plus the existing ECS task-level alarms. `IntegrationLatency` alarms can
  be added later if missed.
- **120s idle timeout and streaming.** The hard constraint driving the
  remediation list above; accepted deliberately as the price of removing
  the fixed cost.

## Rejected alternatives

- **Keep the ALB:** becomes attractive again only if sustained traffic or
  streaming-heavy features make per-request pricing or the 30s cap the
  wrong trade; the stand-up is reversible by deleting the gateway module.
- **NLB:** would only make sense as a private-integration target for a
  REST API, which is itself rejected.
- **REST API:** revisit if WAF or a >30s integration timeout ever becomes
  a hard requirement that the async patterns cannot absorb.
