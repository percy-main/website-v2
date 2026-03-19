# Overall Infrastructure Review Summary

## Overview

Six independent reviews were conducted on the `39-terraform-infrastructure` branch, covering ~3,500 lines of Terraform, CI/CD workflows, and deployment documentation. The infrastructure is **well-structured and cost-conscious** for a community sports club website migrating to AWS. Module decomposition is clean, security fundamentals are solid (OIDC, private subnets, Secrets Manager, S3 hardening), and the deployment plan is thorough.

However, the reviews identified **several issues that should be addressed before production deployment**, including IAM over-permissioning, missing deployment safety nets, a critical S3 bucket naming mismatch, and a TLS certificate gap for staging.

**Estimated current monthly cost:** ~$136-142 (production + staging)
**After recommended optimizations:** ~$77-83/month

---

## Consolidated Findings by Severity

### CRITICAL — Must fix before production deployment

| # | Finding | Flagged By | File(s) | Remediation |
|---|---------|-----------|---------|-------------|
| 1 | **S3 bucket name mismatch** — ECS task role references `percy-main-production-uploads` but CDN module creates `production-percy-main-uploads`. App will get Access Denied on uploads. | Correctness | `ecs-service/main.tf:251`, `cdn/main.tf:39` | Align bucket naming between modules |
| 2 | **Staging ACM certificate wrong domain** — Shared ALB cert covers `api.percymain.org` only, not `api.staging.percymain.org`. Staging HTTPS will fail. | Correctness | `staging/main.tf:89`, `shared/main.tf:318` | Create a separate ACM cert for `api.staging.percymain.org` or add it as a SAN |
| 3 | **Terraform role has AdministratorAccess** on all branches — Any PR can assume full admin via OIDC wildcard trust. | Security, Reliability, AWS | `shared/main.tf:129,145-148` | Scope to `main` only for apply; create read-only plan role for PRs; replace with scoped policy |
| 4 | **CloudFront-to-ALB uses HTTP** — API traffic (auth tokens, payment data) sent unencrypted between CloudFront edge and ALB. | Security, Reliability, Scalability, AWS | `cdn/main.tf:216-222` | Change `origin_protocol_policy` to `"https-only"` |
| 5 | **Terraform state backends commented out** — State stored locally, no locking. Remote state data sources in staging/production will fail. | Security, Reliability, Correctness | `shared/main.tf:11-17`, `production/main.tf:14-21`, `staging/main.tf:15-22` | Uncomment after bootstrap; add CI guard to prevent apply with local state |
| 6 | **No ECS deployment circuit breaker** — Failed deploys loop indefinitely, requiring manual intervention. | Reliability, AWS | `ecs-service/main.tf:399-425` | Add `deployment_circuit_breaker { enable = true; rollback = true }` |
| 7 | **Terraform apply ordering not guaranteed** — GitHub Actions matrix `order` field is ignored; shared/staging/production could apply in any order. | Correctness, Reliability | `terraform.yml:70-104` | Replace matrix with chained jobs using `needs` |
| 8 | **Migration step uses old Docker image** — Migrations run against the current task definition, not the newly built image. | Correctness, Reliability | `deploy-api.yml:77-116` | Register new task def first, or use container overrides with new image |

### HIGH PRIORITY — Important improvements

| # | Finding | Flagged By | Remediation |
|---|---------|-----------|-------------|
| 9 | **Deploy role ECS policy uses `Resource: "*"`** | Security, Correctness, AWS | Scope to `percy-main-*` cluster/service ARNs |
| 10 | **SES task role allows sending from any identity** | Security, AWS | Restrict to `notifications.percymain.org` identity ARN |
| 11 | **No ECS auto-scaling** — fixed at 2 tasks, no elasticity for traffic spikes | Scalability, Reliability, AWS | Add `aws_appautoscaling_target` + CPU target tracking policy |
| 12 | **RDS storage auto-scaling disabled** — no `max_allocated_storage`, writes fail at 20 GB | Scalability, Reliability | Add `max_allocated_storage = 50` |
| 13 | **Production RDS is single-AZ** — full outage on AZ failure, no auto-failover | Reliability, AWS | Set `multi_az = true` (~$13/month increase) |
| 14 | **ECR image tag mutability is MUTABLE** — supply chain risk, tags can be overwritten | Security, AWS | Set `image_tag_mutability = "IMMUTABLE"`, remove `latest` tag push |
| 15 | **No S3 versioning on uploads bucket** — user data loss risk | Reliability, AWS | Enable versioning with 30-day noncurrent expiration |
| 16 | **No ALB access logging** | Security, AWS | Create S3 bucket + enable `access_logs` block |
| 17 | **No WAF configured** — no protection against common web attacks | Security, Reliability | Add WAF with `AWSManagedRulesCommonRuleSet` (~$5/month) |
| 18 | **No RDS deletion protection** | Reliability, AWS | Add `deletion_protection = var.environment == "production"` |
| 19 | **S3 buckets lack explicit encryption config** | Security, AWS | Add `aws_s3_bucket_server_side_encryption_configuration` |
| 20 | **SNS alarm topic not encrypted** | Security, AWS | Add `kms_master_key_id = "alias/aws/sns"` |
| 21 | **NAT Gateway is $35/month** — single biggest cost, can use public subnet pattern | Cost | Set `enable_nat_gateway = false` in production, use public subnets |

### MEDIUM PRIORITY — Should address soon

| # | Finding | Flagged By |
|---|---------|-----------|
| 22 | RDS connection alarm threshold (80) too close to db.t4g.micro limit (~87) | Scalability |
| 23 | No ALB latency alarm (`TargetResponseTime`) | Scalability, Reliability, AWS |
| 24 | ALB deregistration delay defaults to 300s — slows deploys | Scalability, Reliability |
| 25 | CloudFront custom errors intercept API 404s | Correctness |
| 26 | ECR lifecycle too aggressive (10 images) — limits rollback | Scalability, Reliability |
| 27 | No smoke test after deployment | Reliability, AWS |
| 28 | No RDS backup/maintenance window set | Reliability, AWS |
| 29 | RDS password in Terraform state plaintext | Security, AWS |
| 30 | No VPC Flow Logs | Security |
| 31 | No CloudFront access logging | Security, AWS |
| 32 | Container Insights adds ~$8/month with minimal value at this scale | Cost |
| 33 | `log_retention_days` variable unused in monitoring module | Correctness |
| 34 | Production log retention 180 days is excessive | Cost |
| 35 | Deployment plan has incorrect RDS instance identifier and secret names | Correctness |
| 36 | No frontend rollback mechanism | Reliability |
| 37 | `terraform apply -auto-approve` without saved plan artifact | Security, Reliability |

### LOW PRIORITY — Nice-to-have

| # | Finding | Flagged By |
|---|---------|-----------|
| 38 | No RDS Performance Insights (free for 7-day retention) | Scalability, AWS |
| 39 | No RDS Enhanced Monitoring | AWS |
| 40 | Dashboard region hardcoded to `eu-west-2` | Scalability, Correctness |
| 41 | No CloudFront Origin Shield | Scalability |
| 42 | No S3 lifecycle policies on uploads | Scalability, Cost |
| 43 | Secrets Manager could be SSM Parameter Store (saves ~$1.20/month) | Cost |
| 44 | GitHub Actions not pinned to SHA | AWS |
| 45 | Consider Fargate Spot for staging (saves ~$5/month) | Cost |
| 46 | OIDC thumbprint hardcoded | Security |
| 47 | Consider `prevent_destroy` on critical resources | Correctness |
| 48 | No SES bounce/complaint handling | Reliability |
| 49 | No application log metric filters | Reliability |
| 50 | Provider version constraints are loose (`~> 5.0`) | Correctness |

---

## What's Done Well (Consensus Across Reviews)

The reviews consistently praised these aspects:

1. **OIDC for CI/CD** — No long-lived AWS credentials; deploy role scoped to `main` branch only
2. **ARM64/Graviton everywhere** — ECS tasks and RDS use ARM64 for ~20% cost savings
3. **Security group layering** — Proper ALB → ECS → RDS chain with source-SG-based rules
4. **S3 hardening** — Public access blocks + CloudFront OAC (not legacy OAI)
5. **Secrets Manager** — Credentials injected via ECS `secrets` block, not env vars
6. **RDS in private subnets** — `publicly_accessible = false` with SG restricting to ECS only
7. **TLS enforcement** — ALB HTTP→HTTPS redirect, TLS 1.3 policy, CloudFront `redirect-to-https`
8. **ECR image scanning** — `scan_on_push = true` for vulnerability detection
9. **Clean module decomposition** — VPC, RDS, ECS, CDN, DNS, monitoring, scheduling all separate with clear interfaces
10. **Cost-conscious design** — Right-sized instances, single NAT, PriceClass_100, S3 Gateway endpoint
11. **Comprehensive deployment plan** — Bootstrap runbook, apply ordering, verification commands, cost estimates, rollback procedures
12. **Staged deployment pipeline** — Staging-first with GitHub Environment approval gate for production
13. **Container Insights** — Detailed per-task metrics (though may be overkill for cost)
14. **Comprehensive CloudWatch monitoring** — Alarms for CPU, memory, 5xx, unhealthy hosts, RDS metrics + dashboard

---

## Recommended Remediation Plan

### Phase 0: Pre-merge blockers (Critical correctness issues)
1. Fix S3 bucket name mismatch between `ecs-service` and `cdn` modules
2. Fix staging ACM certificate — create cert for `api.staging.percymain.org`
3. Replace Terraform apply matrix with chained `needs` jobs
4. Fix migration step to use new Docker image (container overrides or register task def first)
5. Change CloudFront origin protocol to `https-only`
6. Add ECS deployment circuit breaker with rollback

### Phase 1: Pre-first-apply (security hardening)
7. Scope Terraform IAM role — separate plan (read-only) vs apply roles, restrict trust to `main`
8. Scope deploy role ECS policy to `percy-main-*` resources
9. Scope SES task role to specific identity
10. Set ECR image tag immutability
11. Add CI guard to fail if Terraform backends are still commented out
12. Uncomment S3 backends after state bucket bootstrap

### Phase 2: Pre-production-traffic (reliability)
13. Add ECS auto-scaling (min 2, max 4 for production)
14. Add `max_allocated_storage = 50` on RDS
15. Enable S3 versioning on uploads bucket
16. Add RDS deletion protection for production
17. Set explicit ALB deregistration delay (30s)
18. Increase ECR image retention to 25
19. Add ALB latency alarm
20. Lower RDS connection alarm to 60

### Phase 3: Post-launch improvements
21. Evaluate multi-AZ RDS ($13/month) — depends on payment volume/SLA requirements
22. Add WAF (~$5/month) if attack surface warrants it
23. Enable ALB access logs and CloudFront logging
24. Add S3 encryption configuration
25. Encrypt SNS topic
26. Add smoke tests to deploy pipeline
27. Add VPC Flow Logs
28. Enable RDS Performance Insights (free)

### Cost Optimizations (independent of phases)
- Remove NAT Gateway, use public subnet pattern: **-$35/month**
- Disable Container Insights: **-$8/month**
- Reduce production task_count to 1: **-$7.50/month**
- Fargate Spot for staging: **-$5.25/month**
- Reduce production log retention to 30 days: **-$1.50/month**
- **Total potential savings: ~$57/month** (from ~$140 to ~$83)

---

## Individual Review Files

| Review | File |
|--------|------|
| Security | [`reviews/security.md`](security.md) |
| Reliability | [`reviews/reliability.md`](reliability.md) |
| Scalability | [`reviews/scalability.md`](scalability.md) |
| Correctness | [`reviews/correctness.md`](correctness.md) |
| AWS Best Practices | [`reviews/aws-best-practices.md`](aws-best-practices.md) |
| Cost Efficiency | [`reviews/cost-efficiency.md`](cost-efficiency.md) |
