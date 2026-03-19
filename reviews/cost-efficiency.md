# Cost Efficiency Review

## Summary

This infrastructure is reasonably well-designed for a small community sports club, with several cost-conscious decisions already in place (ARM64 Fargate, single NAT Gateway, db.t4g.micro). However, the **estimated combined monthly cost of ~$130 (production + staging) can be reduced to ~$55-70** by eliminating the NAT Gateway, removing the redundant staging ALB, disabling Container Insights, and reducing log retention. The single biggest cost item -- the NAT Gateway at $35/month -- provides minimal value for this workload and should be the first thing cut.

## Critical Issues

### 1. NAT Gateway is the single largest cost item and is unnecessary

**File:** `infra/environments/production/main.tf` line 53, `infra/modules/vpc/main.tf` lines 107-127

The production environment enables a NAT Gateway (`enable_nat_gateway = true`). At **$34.56/month** (eu-west-2: $0.048/hr) plus $0.048/GB data processing, this is the most expensive single resource in the entire stack -- costing more than the RDS instance and Fargate tasks combined.

For a community sports club API running on Fargate, the NAT Gateway exists solely to let private-subnet tasks reach the internet (ECR image pulls, SES API calls, Stripe API calls, Play Cricket API). However, the staging environment already demonstrates the alternative: **run ECS tasks in public subnets with `assign_public_ip = true`**, exactly as staging does at `infra/environments/staging/main.tf` lines 77-91.

**Recommendation:** Set `enable_nat_gateway = false` in production and use the same public-subnet-with-public-IP pattern as staging. This saves **~$35/month** with zero functional impact. The RDS instance remains in private subnets either way.

If you want to keep tasks in private subnets for security reasons, use **VPC Endpoints** instead of the NAT Gateway. Add Interface Endpoints for ECR (ecr.api + ecr.dkr), CloudWatch Logs, Secrets Manager, and SES. At ~$7.30/endpoint/month this only makes sense if you need 1-2 endpoints, but for 4-5 endpoints it costs more than the NAT Gateway. The public IP approach is the cheapest option.

### 2. Two ALBs doubles load balancer costs unnecessarily

**File:** `infra/modules/ecs-service/main.tf` lines 322-330

Each environment gets its own ALB. An ALB costs a minimum of **$18.40/month** (eu-west-2: $0.02526/hr) before any LCU charges. That is $36.80/month for both environments.

**Recommendation for staging:** Since staging is only used for pre-production testing (not customer-facing), consider whether the staging ALB is necessary. Options:
- Use CloudFront origin directly to the ECS task public IP (eliminates staging ALB, saves ~$18/month)
- Accept the cost as necessary for parity testing

This is borderline -- ALB parity with production has testing value, but $18/month for a staging load balancer on a club website is significant.

## High Priority

### 3. Container Insights adds hidden cost with no value at this scale

**File:** `infra/modules/ecs-service/main.tf` lines 124-133

```hcl
setting {
  name  = "containerInsights"
  value = "enabled"
}
```

Container Insights costs **$0.01 per metric per month** and generates dozens of custom metrics per task. For 2 production tasks + 1 staging task, expect ~$5-10/month in custom CloudWatch metrics costs. The basic ECS metrics (CPU, memory) are already available free via the standard `AWS/ECS` namespace -- which is exactly what your monitoring module already uses.

**Recommendation:** Set `containerInsights = "disabled"`. Your CloudWatch alarms in `infra/modules/monitoring/main.tf` already use the free `AWS/ECS` namespace metrics. Saves **~$5-10/month**.

### 4. Production log retention of 180 days is excessive

**File:** `infra/environments/production/main.tf` line 89, `infra/modules/ecs-service/main.tf` line 79, `infra/modules/monitoring/main.tf` line 20

Production logs are retained for 180 days. CloudWatch Logs ingestion costs $0.57/GB and storage costs $0.03/GB/month (eu-west-2). For a low-traffic club site this is modest, but 180 days is still overkill.

**Recommendation:** Reduce production log retention to **30-60 days**. For a community sports club, 30 days is plenty for debugging. If you need long-term log archival, export to S3 (Standard-IA at $0.0125/GB/month, or Glacier at $0.004/GB/month). Saves **~$1-3/month** depending on log volume.

### 5. Two ECS tasks in production is unnecessary for a club website

**File:** `infra/environments/production/main.tf` line 78

```hcl
task_count = 2
```

Two Fargate tasks (256 CPU / 512 MB each) cost ~$15/month. A single task costs ~$7.50/month. For a community sports club website with likely <100 concurrent users, a single task is sufficient.

Running 2 tasks for "high availability" makes little sense when:
- RDS is single-AZ (`multi_az = false` at line 65) -- the database is already a single point of failure
- There is no auto-scaling configured
- The site's acceptable downtime during deploys is probably measured in minutes, not seconds

**Recommendation:** Set `task_count = 1` for production. If you want zero-downtime deploys, ECS rolling deployment with `minimum_healthy_percent = 100` and `maximum_percent = 200` will temporarily spin up a second task during deploys only. Saves **~$7.50/month**.

### 6. Staging has a full CloudFront distribution -- unnecessary

**File:** `infra/environments/staging/main.tf` lines 123-129

Staging gets its own CloudFront distribution. CloudFront itself has no base cost (pay per request), but it creates complexity and the staging site almost certainly gets negligible traffic. More importantly, it requires a separate ACM certificate and DNS records.

**Recommendation:** For staging, skip CloudFront entirely and access the API directly via the ALB. The frontend can be served from S3 with static website hosting enabled (no CloudFront needed for a staging-only site). This simplifies the staging setup and avoids any CloudFront request charges.

## Medium Priority

### 7. No S3 lifecycle policies on uploads bucket

**File:** `infra/modules/cdn/main.tf` lines 116-155

The uploads bucket has no lifecycle policy. Over time, user uploads (team photos, documents) will accumulate. Without lifecycle rules, everything stays in S3 Standard forever.

**Recommendation:** Add lifecycle rules:
```hcl
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "transition-to-ia"
    status = "Enabled"
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }
}
```
S3 Standard-IA is ~40% cheaper for infrequently accessed uploads. Savings depend on volume but this is good hygiene.

### 8. No S3 lifecycle policy on frontend bucket for old versions

**File:** `infra/modules/cdn/main.tf` lines 71-110

The frontend bucket has no versioning or lifecycle. While `aws s3 sync --delete` in the deploy workflow removes old files, enabling S3 versioning with a noncurrent version expiration rule would protect against accidental deletions while cleaning up old versions:

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}
```

### 9. Secrets Manager costs $0.40/secret/month -- consider SSM Parameter Store

**File:** `infra/modules/rds/main.tf` lines 161-180, `infra/environments/production/secrets.tf`, `infra/environments/staging/secrets.tf`

You have 3 Secrets Manager secrets (RDS credentials per environment + app secrets per environment = 4 total, but RDS module creates one per env). At $0.40/secret/month = **~$1.60/month**. Plus $0.05 per 10,000 API calls.

**Recommendation:** SSM Parameter Store SecureString is free for standard parameters (up to 10,000). Consider using SSM Parameter Store instead of Secrets Manager for the app secrets. Keep Secrets Manager only if you need automatic rotation (which you don't appear to use). Saves **~$1.20/month** -- small but easy.

### 10. Staging scheduled task runs the Play Cricket sync unnecessarily

**File:** `infra/environments/staging/main.tf` lines 166-176

Staging has the EventBridge Play Cricket sync schedule enabled. Each run spins up a Fargate task (256 CPU / 512 MB) for a few minutes. At ~$0.01 per run (2 runs/week), this is cheap (~$0.08/month), but syncing real Play Cricket data into a staging database serves no purpose.

**Recommendation:** Either disable the staging schedule (`state = "DISABLED"`) or add a variable to the scheduling module to control this. Negligible cost savings but reduces noise.

## Low Priority / Recommendations

### 11. Consider Fargate Spot for staging

ECS Fargate Spot offers up to 70% savings over on-demand pricing. Staging tasks can tolerate occasional interruptions.

**Recommendation:** Add `capacity_provider_strategy` to the staging ECS service:
```hcl
capacity_provider_strategy {
  capacity_provider = "FARGATE_SPOT"
  weight            = 1
}
```
This could reduce staging Fargate costs from ~$7.50/month to ~$2.25/month.

### 12. Consider Reserved/Savings Plans for RDS after stabilization

Two db.t4g.micro instances (production + staging) cost ~$26/month on-demand. A 1-year All Upfront Reserved Instance for db.t4g.micro saves ~30%, bringing the cost to ~$18/month. Only commit to this after the infrastructure has been running stably for a few months.

### 13. ECR lifecycle could be more aggressive

**File:** `infra/environments/shared/main.tf` lines 51-70

The ECR lifecycle keeps the last 10 images. For a small club site deploying maybe 2-4 times per month, 5 images would be sufficient. ECR storage is $0.10/GB/month -- minimal savings but good hygiene.

### 14. CloudWatch dashboard has ongoing cost

**File:** `infra/modules/monitoring/main.tf` lines 251-377

CloudWatch dashboards cost **$3.00/month each** after the first 3 free dashboards. With production + staging dashboards, you may exceed the free tier.

**Recommendation:** Consider using a single dashboard with environment toggle, or remove the staging dashboard entirely and rely on the AWS Console's built-in metrics explorer for staging. Saves **$3/month** if you exceed the free tier.

### 15. DynamoDB lock table should use on-demand billing

**File:** `docs/deployment-plan.md` line 54

The deployment plan already specifies `--billing-mode PAY_PER_REQUEST` for the DynamoDB lock table -- good. This is essentially free for the ~10 requests/month a Terraform state lock generates.

## Estimated Monthly Cost Breakdown

### Current Configuration

| Resource | Production | Staging | Notes |
|----------|-----------|---------|-------|
| **NAT Gateway** | **$35.00** | $0.00 | $0.048/hr + data processing |
| **ALB** | $18.40 | $18.40 | $0.02526/hr minimum |
| **ECS Fargate (API)** | $15.00 | $7.50 | 2x tasks prod, 1x staging (256 CPU/512 MB ARM64) |
| **RDS db.t4g.micro** | $12.53 | $12.53 | Single-AZ, 20 GB storage |
| **CloudFront** | $1.00 | $1.00 | PriceClass_100, low traffic |
| **Route 53** | $0.50 | $0.00 | Shared hosted zone |
| **S3** | $0.50 | $0.50 | Minimal storage |
| **Secrets Manager** | $0.80 | $0.80 | 2 secrets per env |
| **CloudWatch Logs** | $2.00 | $1.00 | 180-day / 30-day retention |
| **CloudWatch Alarms** | $0.50 | $0.50 | 7 alarms per env (standard metrics are free up to 10) |
| **CloudWatch Dashboard** | $0-3.00 | $0-3.00 | $3/each after first 3 free |
| **Container Insights** | $5.00 | $3.00 | Custom metrics |
| **ECR** | $0.50 | -- | Shared, ~5 GB images |
| **ECS Scheduled Tasks** | $0.10 | $0.10 | 2 runs/week, few minutes each |
| **Total** | **~$91-94** | **~$45-48** | |
| **Grand Total** | | **~$136-142/month** | |

### After Recommended Optimizations

| Change | Monthly Savings |
|--------|----------------|
| Remove NAT Gateway, use public subnet pattern | -$35.00 |
| Reduce production task_count to 1 | -$7.50 |
| Disable Container Insights | -$8.00 |
| Reduce production log retention to 30 days | -$1.50 |
| Use Fargate Spot for staging | -$5.25 |
| Remove staging CloudFront (optional) | -$0-1.00 |
| Switch app secrets to SSM Parameter Store | -$1.20 |
| **Total Savings** | **~$58-59/month** |
| **Optimized Grand Total** | **~$77-83/month** |

### Aggressive Optimization (if needed)

If budget is very tight, additionally:
- Remove staging ALB entirely (use direct task IP): saves ~$18/month
- Remove staging RDS, use production DB for staging reads: saves ~$13/month (not recommended)
- Optimized total: **~$50-55/month**

## What's Done Well

1. **ARM64 Fargate tasks** (`infra/modules/ecs-service/main.tf` line 274) -- ARM64 is 20% cheaper than x86 and often faster for Node.js workloads. This is an excellent choice.

2. **Single NAT Gateway per environment** (`infra/modules/vpc/main.tf` line 104 comment) -- the module explicitly uses a single NAT Gateway rather than one per AZ. Good cost awareness.

3. **Staging skips NAT Gateway entirely** (`infra/environments/staging/main.tf` line 54) -- `enable_nat_gateway = false` with public IP assignment. This is the right pattern and should be extended to production.

4. **Smallest viable RDS instance** (`infra/environments/production/main.tf` line 63) -- `db.t4g.micro` with 20 GB storage is appropriate for a club website.

5. **Single-AZ RDS** (`infra/environments/production/main.tf` line 65) -- `multi_az = false` avoids doubling the RDS cost. Correct for a non-critical club website.

6. **CloudFront PriceClass_100** (`infra/modules/cdn/main.tf` line 187) -- uses only the cheapest edge locations (North America/Europe). Perfect for a UK-based sports club.

7. **S3 Gateway Endpoint** (`infra/modules/vpc/main.tf` lines 293-306) -- free, avoids NAT Gateway charges for S3 traffic. Good.

8. **ECR lifecycle policy** (`infra/environments/shared/main.tf` lines 51-70) -- keeps only 10 images, preventing unbounded storage growth.

9. **Staging log retention at 30 days** (`infra/environments/staging/main.tf` line 90) -- appropriate for a non-production environment.

10. **EventBridge Scheduler for sync** (`infra/modules/scheduling/main.tf`) -- uses ephemeral Fargate tasks rather than a constantly-running worker. Cost-effective for a twice-weekly job.

11. **Conditional NAT Gateway** (`infra/modules/vpc/main.tf` line 26) -- the `enable_nat_gateway` variable makes it easy to toggle per environment. Good module design.

12. **OIDC for GitHub Actions** (`infra/environments/shared/main.tf` lines 106-110) -- avoids long-lived AWS credentials, no cost impact but good security practice.
