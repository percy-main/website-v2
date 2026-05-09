# ADR 041: RDS backup retention pinned to 1 day until AWS Free Plan is exited

## Status

Accepted

## Context

Issue #216 bumped `backup_retention_period` from `1` to `7` in `infra/modules/rds/main.tf` so a missed weekend backup wouldn't leave Monday morning with nothing to restore. The change applied cleanly in plan; on first apply against production (2026-05-09), AWS returned:

```
Error: updating RDS DB Instance (percy-main-production-db):
operation error RDS: ModifyDBInstance, https response error
StatusCode: 400, RequestID: 1a96a7c5-bc1b-4582-bb1a-9a26fc5a28c0,
api error FreeTierRestrictionError: The specified backup retention
period exceeds the maximum available to free tier customers. To
remove all limitations, upgrade your account plan.
```

The account is on the AWS Free Plan (separate from "free tier" usage credits). The Free Plan caps `backup_retention_period` at 1 day for RDS — there is no Terraform-level workaround.

## Decision

Revert `backup_retention_period` to `1` in the RDS module. Keep the DB event subscription (`enable_event_subscription = true`) and the alarms wiring from #216 in place — those don't depend on retention length, and surface backup failures via SNS regardless.

When the account moves off the Free Plan (typically when the non-profit AWS Activate credits land or billing migrates to Pay-As-You-Go), bump retention back to 7 and revisit this ADR.

## Why not the alternatives

- **Upgrade the AWS billing plan now.** Out of repo scope; depends on the non-profit credit timing and whoever administers the AWS account billing. Tracked separately.
- **Take manual snapshots on a schedule** to compensate for the 1-day automated retention. Possible (Lambda + EventBridge or a workflow), but adds operational surface area for a stop-gap. Defer until Free Plan upgrade is ruled out for the long term.
- **Multi-AZ for the durability gap** instead of longer retention. Multi-AZ also has a Free Plan restriction and would change the cost profile materially.

## Consequences

- Backup horizon stays at ~1 day. A missed Sunday backup means Monday's restore target is the most recent Sunday-or-later snapshot — which may be insufficient if a corruption was introduced on Friday and only spotted Monday.
- The DB event subscription will surface "backup failed" / "backup skipped" events via the `percy-main-production-db-events` SNS topic, so the gap is visible.
- The RDS restore drill (ADR 039) acquires extra value here: with a 1-day window, the restore path matters more, not less.
- Issue #216 stays open with the bump-to-7 change as a follow-up; this ADR is the "why we backed off" record.

## Trigger to revisit

Any of:

- AWS account moves off the Free Plan (activated Activate credits, billing change).
- A real recovery scenario hits the 1-day window and we lose data.
- The DB event subscription fires on a backup failure that can't be retried within the 1-day window.
