# ADR 038: Defer ALB + CloudFront access-log forwarding to NR until #200 lands

## Status

Accepted

## Context

Two front-door log streams already write to S3:

- ALB access logs → `s3://percy-main-${env}-alb-logs/alb/` (`infra/modules/ecs-service/main.tf:608-674`), 90-day lifecycle.
- CloudFront standard logs → `s3://percy-main-${env}-cdn-logs/cloudfront/` (`infra/modules/cdn/main.tf:364-368`), same pattern.

Both are write-only archives today: useful for ad-hoc forensics via Athena, but cannot drive a 5xx-rate dashboard or correlate a user complaint to a specific request. Issue #222 asked whether to forward them into NR (S3 EventBridge → Lambda → NR for ALB; CloudFront real-time logs → Firehose → NR for CDN) or to accept the limitation.

## Decision

**Defer**: do not forward ALB or CloudFront access logs into NR until issue #200 (NR log forwarder for app + VPC + RDS + ALB + CloudFront) lands. Once #200 is in place, the marginal change is configuration on the existing forwarder rather than a separate Lambda/Firehose pipeline, so it's wasted work to design a separate pipeline now.

While deferred, ad-hoc forensics on these logs uses Athena queries against the S3 prefix.

## Why this option

- **Front-door log volume is high.** Either path (Lambda or Firehose) costs real money at our current traffic shape, and neither is "free" once the ingest hits NR. Wiring it before there's a consumer (a dashboard or alert) means paying for data nobody reads.
- **#200 will absorb this naturally.** A single forwarder with multiple sources is simpler operationally than three independent pipelines (app logs, ALB, CloudFront). Once #200 lands, switching ALB and CloudFront on is a one-config-line change.
- **Existing 5xx alarming should move to NR-side once #209 / #210 land.** That work doesn't depend on having forwarded access logs — CloudWatch metrics on the ALB/CDN entities are already published.

## Consequences

- During the deferral window, no NR-side dashboard exists for ALB/CloudFront request-level data. Forensics requires Athena.
- Reconsider when #200 lands. At that point the implementation is a small config change in the forwarder rather than a new module.
