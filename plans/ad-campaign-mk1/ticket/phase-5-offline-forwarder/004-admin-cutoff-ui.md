# 004 — Per-lead attribution cutoff in admin outcome UI

**Phase**: 5 — Offline forwarder + outcome uploads
**Depends on**: phase-2-lead-capture/005
**Effort**: S

## Context

Admins need to know when an outcome click will actually reach Ads vs be recorded only in our DB. A per-lead cutoff date tells them.

## Scope

### In

- Extend `GET /api/admin/leads` response with, per lead:
  - `adsCutoffAt` — ISO date computed as `lead.attribution.first_seen_at + min(conversionActionWindow_for_{attended|member}, 63 days)` (use the shorter of the two relevant outcome windows).
  - Derived from `packages/shared/src/marketing/campaigns.ts` — the registry exposes per-event windows.
- Web UI:
  - If `now() > adsCutoffAt`, the Attended / Joined buttons visually indicate "(past Ads window — DB only)". Clicking still emits the event and updates status, but the forwarder will skip the upload per ticket 003.
  - Tooltip explains why.
- No change to the outcomes endpoint behaviour.

### Out

- The skip logic itself (that lives in the payload builder, ticket 003).

## Approach

- Keep the cutoff computation in a shared utility so front and back agree. Potentially expose from `@percy-main/shared/marketing`.

## References

- [CONVERSION_TRACKING.md §11 Attribution windows](../../CONVERSION_TRACKING.md#11-offline-conversion-forwarder)

## Acceptance

- [ ] A lead with `first_seen_at` older than 63 days shows "(past Ads window)" on Attended/Joined buttons.
- [ ] Admin can still click the button — the event is recorded; no outbox row is created OR the outbox row is marked `succeeded` immediately with `skipped_no_match`.
- [ ] Tooltip or inline text explains the reason.
