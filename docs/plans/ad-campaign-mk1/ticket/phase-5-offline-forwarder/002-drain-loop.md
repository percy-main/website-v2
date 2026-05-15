# 002 — Outbox drain loop (Fastify plugin)

**Phase**: 5 — Offline forwarder + outcome uploads
**Depends on**: 001
**Effort**: M

## Context

In-process periodic drain of `marketing_outbox` rows. Fastify plugin, `setInterval(30s)`, locks a batch, uploads, updates. Simple enough to start with; can move to an ECS scheduled task later per the doc.

## Scope

### In

- `apps/api/src/features/marketing/forwarder.ts`:
  - `createForwarder(app)` — Fastify plugin that registers an interval on `ready` and clears it on `close`.
  - `drainOnce()`:
    1. `SELECT … FOR UPDATE SKIP LOCKED LIMIT 20 WHERE status='pending' AND next_attempt_at <= now()`.
    2. Group by destination. For `google_ads`, hand off to the builder (ticket 003) and `uploadClickConversions`.
    3. On success: mark `succeeded`, set `succeeded_at`.
    4. On `AdsValidationError`: mark `dead` immediately, store the error message.
    5. On `AdsTransientError` or network: increment `attempts`, set `next_attempt_at = now() + backoff(attempts)` (1m, 5m, 30m, 2h, 6h, 24h), mark `dead` after 6th attempt.
  - Skipped entirely if the Ads client is a no-op.
- Structured logs via the existing logger (New Relic picks them up).

### Out

- Building the payload (ticket 003).
- Admin UI (ticket 005).

## Approach

- Use a single Postgres advisory lock or the `SKIP LOCKED` pattern so multiple instances can coexist (we run single-instance today but don't paint ourselves into that corner).
- Tests: unit test the state machine with a mocked Ads client.

## References

- [CONVERSION_TRACKING.md §11 Where it runs / Retry & failure](../../CONVERSION_TRACKING.md#11-offline-conversion-forwarder)

## Acceptance

- [ ] Fastify boots with the plugin; interval starts on `ready`.
- [ ] `pending` rows transition to `succeeded` when the Ads client returns OK.
- [ ] Validation error → `dead` without retry.
- [ ] Transient error → retried with backoff; marked `dead` after 6 attempts.
- [ ] Integration test with a mocked Ads client passes.
