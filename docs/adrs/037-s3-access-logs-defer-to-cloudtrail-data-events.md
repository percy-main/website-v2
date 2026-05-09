# ADR 037: Documents bucket audit — defer to CloudTrail data events, not S3 server access logs

## Status

Accepted

## Context

`infra/modules/documents-bucket/main.tf` provisions a bucket configured for object lock in COMPLIANCE mode (regulator-grade retention). The other site buckets (`infra/modules/cdn/main.tf`) are similar in shape. None of them currently configure `aws_s3_bucket_logging` — so there is no audit trail for "who attempted to delete an object", "who downloaded what", or "what failed an authz check".

Issue #221 raised two ways to plug the gap:

1. **`aws_s3_bucket_logging` per bucket** (S3 server access logs) — text logs into a dedicated logs bucket, lifecycle to expire at N days. Cheap. Queryable via Athena.
2. **CloudTrail data events** for the documents bucket (#214 / #215 already plan account-wide CloudTrail) — structured JSON, route into NR via the forwarder (#200 in flight). Pricier per event but much better integrated with the rest of the observability stack.

## Decision

Defer adding `aws_s3_bucket_logging` to any bucket. Plan for CloudTrail data events (configured in #215) plus NR forwarding (#200) to cover the documents-bucket audit case once those land.

If #200 / #215 stall for >90 days, revisit and add S3 server access logs as a tactical fallback.

## Why this option

- **The integration story matters more than ingest cost.** Server access logs land as text in S3; they're query-able via Athena but disconnected from the rest of the observability stack (NR APM/Logs/Browser, GitHub Actions issues). CloudTrail data events flow through the same NR pipe as everything else, so an "object deleted by X" event sits in the same dashboard as "deploy by Y rolled back" and "auth failure on Z account".
- **CloudTrail is already planned (#214 / #215)**, so the marginal change is small: add the documents bucket to the data-events selectors when the trail lands.
- **Doing both adds a permanent operational tax** (extra logs bucket, lifecycle, periodic Athena cost review) for low marginal value. If CloudTrail data events prove too expensive at our document volume we can switch direction; the regulator only requires *some* audit trail, not a specific format.

## Consequences

- Until #214 / #215 / #200 land, there is no per-object audit trail on the documents bucket beyond bucket-versioning + object-lock. Acceptable for a regulator-driven retention requirement (the data is preserved); insufficient for "who accessed file X on date Y" investigations during the gap.
- A reminder should sit in #214/#215 to add the documents bucket prefix to the data-events selectors. Tracked here so it isn't forgotten.
