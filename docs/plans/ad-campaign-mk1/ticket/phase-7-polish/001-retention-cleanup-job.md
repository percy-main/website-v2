# 001 — Nightly retention cleanup job

**Phase**: 7 — Operational polish
**Depends on**: Phase 1–5 fully deployed
**Effort**: S

## Context

Privacy notice commits to a 3-year retention for unlinked leads and their events. Need a scheduled job to enforce it. Not urgent at launch — no data is 3 years old — but must be in place before it is.

## Scope

### In

- Standalone script under `apps/api/src/cleanup-runner.ts` (mirrors `apps/api/src/sync-runner.ts`):
  - Delete `lead` rows where `member_id IS NULL AND created_at < now() - interval '3 years'`.
  - Cascade to `marketing_event` (FK-cascade on `lead_id`; if the FK isn't ON DELETE CASCADE, delete events first).
  - Delete `marketing_outbox` rows where `status = 'succeeded' AND succeeded_at < now() - interval '90 days'`.
  - Log counts; exit 0/1 depending on success.
- Terraform: ECS scheduled task, nightly at e.g. 03:15 UTC (low traffic).
- Integration test: seed a mix of old/new/linked/unlinked leads, run the cleanup, assert the right rows survived.

### Out

- A UI to trigger it manually (not needed).

## Approach

- Model after `sync-runner.ts`. Same config entry points, same exit-code contract.
- Use a single transaction so the job is effectively atomic per run.

## References

- [CONVERSION_TRACKING.md §16 Retention](../../CONVERSION_TRACKING.md#16-consent-compliance-retention)

## Acceptance

- [ ] Integration test passes.
- [ ] ECS scheduled task deployed.
- [ ] Dry-run with `--dry-run` flag prints counts without deleting.
