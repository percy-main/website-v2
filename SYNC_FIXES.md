# Play-Cricket Sync Fixes

Single PR covering schedule, runner crash, fantasy gating, dead-letter alerting, and admin-triggered sync.

## Scope

1. Cron schedule (Sun/Mon/Tue overnight, replacing Sun/Fri)
2. Pool double-end fix in `sync-runner.ts`
3. Always recompute fantasy scores (drop the `matchesProcessed > 0` gate)
4. EventBridge DLQ + CloudWatch alarms
5. Admin "Sync now" button in fantasy admin area

Deferred to follow-up tickets: teams-endpoint 401; result corrections after first sync.

## 1. Cron schedule

`infra/modules/scheduling/main.tf:119`

Change `cron(0 3 ? * SUN,FRI *)` → `cron(0 3 ? * SUN,MON,TUE *)`.

League rule: results uploaded by Mon 7pm. Three overnight runs cover the upload window:

- **Sun 03:00 BST** — Sat-Sun overnight: Sat games uploaded same-day
- **Mon 03:00 BST** — Sun-Mon overnight: Sun games + late Sat uploads
- **Tue 03:00 BST** — Mon-Tue overnight: final catch-all (Mon 7pm deadline + 8h buffer)

Friday cron dropped. Midweek games (Wed/Thu) will wait until Sun 03:00 — accepted.

## 2. Pool double-end

`apps/api/src/sync-runner.ts:44-45, 49-50`

`client.destroy()` already calls `pool.end()` via Kysely's `PostgresDialect` — the explicit `pool.end()` then throws `Called end on pool more than once`, exit code 1, ECS marks every task as FAILED. Remove the explicit `pool.end()` calls in both the success and `catch` paths. Keep `client.destroy()`.

Verify: build, run `node apps/api/dist/sync-runner.js` against local Docker Postgres, confirm exit code 0.

## 3. Always recompute fantasy scores

`apps/api/src/features/play-cricket/sync.ts:570`

Drop the `if (result.matchesProcessed > 0)` gate. Always call `calculateFantasyScores(db)(season)`. It's idempotent (upserts), so harmless when nothing changed; cost is one season-wide aggregation per run, fine. Also picks up scoring-rule edits and chip changes between matches.

## 4. EventBridge DLQ + alarms

Two distinct alerting paths — the EventBridge DLQ does **not** catch task crashes; it only catches `RunTask` invocation failures (IAM, capacity, throttling). We need both.

### 4a. SQS DLQ for invocation failures

In `infra/modules/scheduling/main.tf`:

- `aws_sqs_queue.scheduler_dlq` — encrypted, 14-day retention.
- Extend `aws_iam_role_policy.scheduler_ecs` (or add a sibling policy): `sqs:SendMessage` on the new queue ARN.
- Add `dead_letter_config { arn = aws_sqs_queue.scheduler_dlq.arn }` inside the schedule's `target` block.
- `aws_cloudwatch_metric_alarm` on `AWS/SQS` `ApproximateNumberOfMessagesVisible >= 1`, period 300s, evaluation_periods 1. Action: SNS topic.

### 4b. Logs metric filter for task crashes

- `aws_cloudwatch_log_metric_filter` on `/ecs/production-api` matching `"Sync failed"`.
- `aws_cloudwatch_metric_alarm` on the resulting custom metric, threshold ≥ 1, period 300s. Action: same SNS topic.

### SNS topic

Add a new alerts SNS topic — likely a sibling `infra/modules/alerting/` module so it can be reused later (rather than burying it inside `scheduling`).

- `aws_sns_topic.alerts` — name `percy-main-${var.environment}-alerts`.
- `aws_sns_topic_subscription` — protocol `email`, endpoint `alex.young@percymain.org`. Note: email subscriptions require manual confirmation via the link AWS sends; subscription will sit `PendingConfirmation` until clicked. Document this in the PR.
- Output the topic ARN; consume from the scheduling module.

## 5. Admin "Sync now" button

### 5a. Backend

New route: `POST /api/admin/play-cricket/sync` (likely a new `admin-routes.ts` under `apps/api/src/features/play-cricket/`, registered alongside the existing routes plugin).

- Auth: `getAuthSession(request)` + admin-role check. Verify by reading `apps/api/src/features/admin/` or other admin routes for the existing pattern.
- Trigger mechanism: **call ECS RunTask** with the same task definition + container override used by EventBridge (`["node","apps/api/dist/sync-runner.js"]`). Re-uses the cron code path 1:1, isolates resources, no API timeout risk.
  - Add `@aws-sdk/client-ecs` to `apps/api`.
  - API task role needs `ecs:RunTask` on the api task definition and `iam:PassRole` for the task execution + task roles. New terraform in the API service module.
  - Read cluster ARN, task def family, subnets, SG from `app.config` (extend `parseConfig`).
- Response: `202 Accepted` with `{ taskArn }`. Don't block on sync completion (full sync can take minutes).
- Schemas in `schemas.ts`; run `pnpm run openapi:generate` after.

**Alternative considered**: run `runSync` inline in the API process. Rejected — blocks a Fastify worker for minutes, uses the API's pool, fights request timeouts. Stick with ECS RunTask.

### 5b. Frontend

Locate the fantasy admin area under `apps/web/src/` (likely `routes/admin/fantasy/` or similar — confirm during implementation).

- Add "Sync Play-Cricket now" button.
- `useMutation` calling `callApi(api.POST("/api/admin/play-cricket/sync"))`.
- Disabled while pending; toast on success ("Sync started — data will appear in a few minutes"); toast on error.
- No progress UI — admin refreshes after a couple of minutes.

## Known gaps deliberately deferred

- **Teams endpoint 401** (`/sites/{siteId}/teams.json`): separate issue. Non-fatal, team data is current.
- **Result corrections after first sync**: if a captain uploads Sun then corrects Mon afternoon, the Tue cron will skip the match (already in `match_result`). Three-cron schedule covers the _initial upload_ window, not later edits. Accept for now; if it bites, drop the `processedMatchIds` skip for matches younger than ~21 days.
- **Stale `match_performance_*` rows** if a scorecard removes a player after first sync. Won't happen often; out of scope.

## PR checklist

- [ ] Terraform: cron updated, DLQ + alarms added, plan reviewed
- [ ] `sync-runner.ts` pool double-end removed; runner exits 0 locally against Docker
- [ ] Fantasy recompute gate removed in `sync.ts`
- [ ] Logs metric filter for "Sync failed" wired to SNS
- [ ] Admin sync route: auth, schemas, OpenAPI regenerated
- [ ] API task role gains `ecs:RunTask` + `iam:PassRole` (terraform)
- [ ] Admin button: mutation, disabled-while-pending, toast
- [ ] Manual e2e: click button → ECS task starts → matches appear → fantasy scores update
- [ ] `pnpm run typecheck && pnpm run lint && pnpm format:check && pnpm --filter api test` all green
