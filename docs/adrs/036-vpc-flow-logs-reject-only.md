# ADR 036: VPC flow logs — REJECT only, kept in CloudWatch

## Status

Accepted

## Context

`infra/modules/vpc/main.tf` previously sent `traffic_type = "ALL"` flow logs into a CloudWatch Log Group with 30-day retention. CloudWatch Logs ingest is ~$0.50/GB; on a busy VPC even a small site like ours produces meaningful volume from health-check fan-out, NAT gateway egress, RDS connection churn, and ECR pulls.

There is no consumer for the logs today: NR forwarding (#200) is not yet wired, and nobody has run a CloudWatch Logs Insights query against the group in months. The logs are pay-to-archive.

Issue #220 raised three options:

1. `traffic_type = "REJECT"` — only failed connections (~10× less volume), still useful for security investigations.
2. Move to S3 + Athena — much cheaper at rest, queryable on demand.
3. Remove flow logs entirely — no consumer today, so the data is unused.

## Decision

Pick **option 1: `traffic_type = "REJECT"`**. Keep CloudWatch Logs as the destination (no S3/Athena hop) but drop ALL → REJECT.

## Why this option

- **Reject logs preserve the most important security signal** (failed connection attempts to ports we don't expose, denied SG/NACL ingress) at ~10× less volume. This is the data we'd actually reach for during an incident.
- **Option 2 (S3 + Athena) adds operational surface area** — bucket policy, lifecycle, partitioning, a queryable schema, possibly Glue catalog — for a benefit we wouldn't realise until incident time. The cost saving over CloudWatch Logs is modest at the volume option 1 produces.
- **Option 3 (remove entirely) is one step too far**: the security-forensics use case is real even if rare, and re-enabling later means losing the historical data leading up to whatever incident prompted it.

## Consequences

- Flow log volume drops by an estimated 10× (rough rule of thumb; revisit after a billing cycle).
- Traffic-accounting use cases (e.g. "how much did the API egress to S3 this month") are no longer answerable from flow logs. Use VPC Lattice metrics, NR network monitoring, or per-service CloudWatch metrics if that question comes up.
- Revisit when #200 (NR forwarding) lands; if NR ingest is cheap enough, may want to flip back to ALL there.
