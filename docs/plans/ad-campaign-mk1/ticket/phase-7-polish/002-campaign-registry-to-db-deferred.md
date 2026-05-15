# 002 — (Deferred) Promote campaign registry to DB

**Phase**: 7 — Operational polish
**Depends on**: —
**Effort**: M (when picked up)
**Status**: **Deferred** — not on current roadmap. Write up for the record.

## Context

Campaigns currently live in `packages/shared/src/marketing/campaigns.ts`. Adding a new campaign requires a dev to ship a PR. For a single-admin club this is fine indefinitely. If volunteers / a marketing manager ever want to create campaigns without a dev, move the registry to a `marketing_campaign` DB table + admin UI.

## Scope (when/if picked up)

- Migration: `marketing_campaign(id, display_name, segments jsonb, conversion_actions jsonb, default_value_pence, active_from, active_to, created_at, ...)`.
- Admin CRUD UI under `/admin/campaigns`.
- Registry resolver in `emitMarketingEvent` reads from DB with in-memory cache (5 min TTL).
- Keep the code-based registry as a fallback for campaigns that predate DB migration.

## Trigger to pick up

- A non-dev explicitly asks to create a campaign.
- We exceed ~5 concurrent campaigns.

Until then, leave the registry in code.

## References

- [CONVERSION_TRACKING.md §6 Campaign registry](../../CONVERSION_TRACKING.md#6-campaign-registry)
- [CONVERSION_TRACKING.md §20 What's explicitly deferred](../../CONVERSION_TRACKING.md#20-whats-explicitly-deferred)
