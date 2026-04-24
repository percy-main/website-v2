# 001 — Database migration: `lead`, `marketing_event`, `marketing_outbox`

**Phase**: 1 — Foundations
**Depends on**: none
**Effort**: M

## Context

The first code change in the whole rollout. Creates the three tables the rest of the platform depends on. Nothing user-visible.

## Scope

### In

- New migration file under `packages/db/src/migrations/` following existing timestamp-prefix convention.
- `lead` table with consent columns (see schema in doc).
- `marketing_event` table with indexed `(type, created_at)`, `(lead_id)`, `(campaign_id, type, created_at)`, and partial index `(ads_conversion_action, created_at) WHERE ads_conversion_action IS NOT NULL`.
- `marketing_outbox` table with `(status, next_attempt_at)` and `(event_id)` indexes.
- Regenerate `packages/db/src/__generated__/db.ts` via `pnpm run db:types`.

### Out

- Any routes, services, or API surface — those come in Phase 2.
- Seed data.

## Approach

- Use the `add-migration` skill. Conventions: `TEXT` UUID primary keys, `TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP` timestamps, `JSONB` for attribution/payload, index naming `idx_<table>_<cols>`.
- Use `REFERENCES "user"(id)` (quoted) for better-auth user FKs.
- `lead.member_id REFERENCES member(id)`; leave nullable.
- Do not add a UNIQUE constraint on `lead.email` — legitimate duplicates (shared family email) are expected.

## References

- [CONVERSION_TRACKING.md §4 Database schema](../../CONVERSION_TRACKING.md#4-database-schema)

## Acceptance

- [ ] Migration applies cleanly on a fresh DB.
- [ ] `pnpm run db:types` produces a diff with the three new tables.
- [ ] `pnpm -w run typecheck` passes.
- [ ] `pnpm -w run lint` passes.
