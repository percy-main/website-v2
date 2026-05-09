# ADR 039: RDS restore drill — manual, quarterly

## Status

Accepted

## Context

`infra/modules/rds/main.tf` provisions automated RDS backups (now 7-day retention since #216). A backup that has never been restored is aspirational — the only way to know recovery actually works is to do it.

Issue #217 raised two ways to validate periodically:

1. **Scheduled GitHub Actions workflow** that quarterly:
   - Restores the latest snapshot to a throwaway RDS instance.
   - Connects, runs a smoke query (`SELECT count(*) FROM user`).
   - Tears the instance down.
2. **A documented manual drill in a runbook**, performed quarterly by whoever is on rota.

## Decision

Adopt **option 2: a documented manual quarterly drill**, captured in this ADR. The first drill is to be performed within 30 days of this ADR landing; outcome (success/failure + cause) recorded as a comment on issue #217 before closing.

Subsequent drills happen quarterly (Mar, Jun, Sep, Dec). The triage rota owner for that quarter runs the drill.

## Why option 2

- **The team is one person.** The ROI on building, maintaining, and debugging a quarterly automated workflow against the cost of doing the manual drill four times a year is negative at this size. An automated drill that breaks silently is worse than a manual drill that occasionally slips a week.
- **Runbook captures the muscle memory.** A manual drill exercises the actual recovery path the operator would use during an incident. An automated workflow exercises only the happy path and obscures the parts (snapshot selection, parameter group reconciliation, network/SG attachment) that go wrong in real recovery.
- **Cost is fully variable.** Running a t4g.micro restore for ~30 minutes once a quarter is a few cents. No standing instance, no Lambda + Step Function plumbing.

## Drill procedure

For the on-rota person each quarter:

1. In the AWS console, find the latest automated snapshot for `percy-main-production-db`.
2. Restore as `percy-main-restore-drill-YYYYMMDD` to a `db.t4g.micro` in the production VPC, attached to the RDS security group (so the Tailscale router can reach it).
3. From a tailnet-connected machine, connect with the credentials in Secrets Manager (`percy-main-production/rds/credentials` — note: the secret path uses `<env-prefix>/rds/credentials`, see `infra/modules/rds/main.tf`).
4. Run smoke query: `SELECT count(*) FROM "user";` and confirm a non-zero count.
5. Run a timing query: `SELECT now() - max(created_at) FROM session;` to verify the snapshot is reasonably fresh.
6. Delete the restored instance.
7. Comment on issue #217 (or its successor — open a fresh tracker each quarter) with:
   - Snapshot identifier used.
   - Restore start / connect / drop timestamps.
   - Smoke query result.
   - Anything that went wrong.

## Consequences

- A drill can slip. If the rota person doesn't run it, the next quarter's person picks it up; two missed quarters in a row should escalate to revisit this ADR (probably to automate).
- The cost is approximately 4 × 30 min × t4g.micro storage ≈ negligible.
- If the team grows to >2 active operators, reconsider option 1 — the manual drill loses the muscle-memory argument once recovery is no-longer-rare.
