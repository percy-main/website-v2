# Marketing retention cleanup deployment notes

The runtime is shipped (`apps/api/src/cleanup-runner.ts` +
`features/marketing/retention.ts`) with integration tests covering
the three behaviours: 3-year unlinked-lead deletion, linked-lead
preservation, and 90-day succeeded-outbox prune.

## Local + manual run

```bash
DATABASE_URL=postgres://percy:percy@localhost:5433/percy_main \
  pnpm --filter api exec tsx src/cleanup-runner.ts --dry-run

# Real run (idempotent, transactional):
DATABASE_URL=... pnpm --filter api exec tsx src/cleanup-runner.ts
```

## Production deployment (open)

Mirroring the existing `sync-runner.ts` ECS scheduled task pattern:

1. Build target — the runner imports `@percy-main/db` and
   `@percy-main/shared/marketing`; the existing API container image
   already ships these. We can either:
   - add a separate task definition that overrides the entrypoint to
     `node dist/cleanup-runner.js`, or
   - extend the existing sync task definition with a separate
     CMD; safer to keep them isolated.
2. Schedule — EventBridge Scheduler, daily at 03:15 UTC (low traffic).
   Same `infra/modules/scheduling/main.tf` pattern as the sync task.
3. Alarms — pipe non-zero exit codes through the same SNS topic
   `alarms_sns_topic_arn` already wired for sync.
4. First production run should be `--dry-run` to confirm volume
   estimates match expectations before live deletion.

## Why this is in a doc, not a Terraform commit

The Terraform module change touches IAM roles + EventBridge schedules
that the user reviews carefully (scheduled jobs running unattended on
production data). Better to land the runtime + tests in this branch
and let the infra/Terraform PR follow with explicit owner sign-off.
