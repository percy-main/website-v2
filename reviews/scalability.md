# Scalability Review

## Summary

This infrastructure is well-designed for a community sports club website, with sensible cost-conscious defaults (ARM64 Fargate, db.t4g.micro, single NAT gateway, PriceClass_100). The primary scalability gap is the complete absence of ECS auto-scaling -- the service is fixed at 2 tasks with no mechanism to handle traffic spikes (e.g. match day, membership renewal deadlines). There are also several missing configuration options around database connection limits, ALB timeouts, and storage growth that should be addressed before production launch.

## Critical Issues

### 1. No ECS auto-scaling policy

**Files:** `infra/modules/ecs-service/main.tf` (lines 399-425), `infra/environments/production/main.tf` (lines 75-116)

The ECS service has a fixed `desired_count = 2` with no `aws_appautoscaling_target` or `aws_appautoscaling_policy` resources. If a traffic spike occurs (match day fixture page, membership renewal window, share image going viral on social media), the two tasks absorb all load with no ability to scale out. With only 256 CPU units (0.25 vCPU) and 512 MB memory per task, headroom is minimal.

**Remediation:** Add target-tracking auto-scaling to the ECS service module:

```hcl
variable "min_tasks" {
  type    = number
  default = 2
}

variable "max_tasks" {
  type    = number
  default = 4
}

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.max_tasks
  min_capacity       = var.min_tasks
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.name_prefix}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
```

For this workload, `min_tasks = 2` and `max_tasks = 4` in production is proportionate. Staging can use `min_tasks = 1`, `max_tasks = 2`.

### 2. RDS has no max_allocated_storage (auto-scaling disabled)

**File:** `infra/modules/rds/main.tf` (lines 127-155)

The RDS instance has `allocated_storage = 20` but no `max_allocated_storage` parameter. This means storage auto-scaling is implicitly disabled. If the database reaches 20 GB, writes will fail. The monitoring alarm at line 203 triggers at 2 GB free, but by then manual intervention is needed.

**Remediation:** Add `max_allocated_storage` to enable RDS storage auto-scaling:

```hcl
variable "max_allocated_storage" {
  type    = number
  default = 50
}

# In aws_db_instance.main:
max_allocated_storage = var.max_allocated_storage
```

50 GB is generous for a community club and adds no cost until storage is actually used.

## High Priority

### 3. No connection pooling or database connection limit awareness

**Files:** `infra/modules/rds/main.tf` (line 29, `db.t4g.micro`), `infra/modules/ecs-service/main.tf` (lines 13-26), `infra/modules/monitoring/main.tf` (line 228)

`db.t4g.micro` has approximately 87 max connections by default (based on the `{DBInstanceClassMemory/9531392}` formula with 1 GB RAM). With 2 ECS tasks, each running a Fastify server that likely opens a connection pool of ~10 connections, plus the scheduled sync task, this is fine at baseline. However, if auto-scaling is added (as recommended above) and tasks scale to 4, you could reach 40+ connections from the API alone, which is still within limits but leaves less headroom.

The monitoring alarm at line 228 triggers at 80 connections, which is close to the actual limit of ~87. By the time you are alerted, the database may already be rejecting connections.

**Remediation:**
- Lower the `rds_connections_high` alarm threshold to 60 (roughly 70% of the ~87 limit) to give earlier warning.
- Consider adding a `max_connections` parameter to the RDS parameter group or document the expected pool size per task.
- If auto-scaling is added, consider using RDS Proxy or `pgbouncer` as a sidecar. For this workload size, a documented pool-size-per-task convention is sufficient for now.

### 4. ALB has no request rate or latency alarms

**File:** `infra/modules/monitoring/main.tf`

The monitoring module tracks ALB 5xx errors (line 132) and unhealthy hosts (line 154), but there are no alarms for:
- `TargetResponseTime` -- high latency is often the first sign of a scaling bottleneck.
- `RequestCount` -- no baseline awareness of traffic volume.
- `RejectedConnectionCount` -- would indicate ALB capacity issues.

**Remediation:** Add at minimum a target response time alarm:

```hcl
resource "aws_cloudwatch_metric_alarm" "alb_latency_high" {
  alarm_name          = "${local.prefix}-alb-latency-high"
  alarm_description   = "ALB p99 response time exceeds 2 seconds"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 2
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}
```

### 5. Single NAT Gateway is a single point of failure

**File:** `infra/modules/vpc/main.tf` (lines 107-127)

Production uses a single NAT Gateway in the first AZ (`aws_subnet.public[0]`). If `eu-west-2a` has an AZ outage, all private subnet outbound traffic (ECS tasks pulling images, calling external APIs like Stripe/Play Cricket, sending SES email) will fail. The ECS tasks in the other AZ will be running but unable to reach the internet.

**Remediation:** For a community sports club, a single NAT Gateway is a reasonable cost trade-off (~$35/month vs ~$70 for two). However, this should be explicitly documented as a known limitation. If the site handles payments via Stripe, an AZ outage blocking Stripe webhooks could cause financial issues. Consider:
- Documenting this as an accepted risk in the deployment plan.
- Adding a variable `nat_gateway_per_az` (default `false`) that can be toggled if needed.
- Alternatively, using VPC endpoints for ECR and CloudWatch Logs (ECR endpoint is ~$7/month) to reduce NAT dependency, then only Stripe/Play Cricket/SES need outbound NAT.

### 6. No ALB idle timeout or deregistration delay configuration

**File:** `infra/modules/ecs-service/main.tf` (lines 322-330, 336-356)

The ALB uses the default idle timeout (60 seconds) and the target group uses the default deregistration delay (300 seconds). During deployments, the 300-second deregistration delay means old tasks hang around for 5 minutes. With only 2 tasks, this means half your capacity is draining for 5 minutes during every deploy.

**Remediation:** Add explicit configuration:

```hcl
resource "aws_lb" "main" {
  # ... existing config ...
  idle_timeout = 60  # explicit, matches default
}

resource "aws_lb_target_group" "api" {
  # ... existing config ...
  deregistration_delay = 30  # 30 seconds is plenty for a Fastify API
}
```

## Medium Priority

### 7. CloudFront API origin uses HTTP-only to ALB

**File:** `infra/modules/cdn/main.tf` (lines 216-222)

The ALB origin uses `origin_protocol_policy = "http-only"`. This means traffic between CloudFront and the ALB is unencrypted. While this is within AWS's network and the ALB has HTTPS configured (line 380 of ecs-service), using `https-only` would provide defense in depth.

**Remediation:** Change to `https-only` since the ALB already has a TLS certificate:

```hcl
custom_origin_config {
  http_port              = 80
  https_port             = 443
  origin_protocol_policy = "https-only"
  origin_ssl_protocols   = ["TLSv1.2"]
}
```

### 8. No S3 lifecycle policies on uploads bucket

**File:** `infra/modules/cdn/main.tf` (lines 116-166)

The uploads bucket has no lifecycle policy. Over time, user uploads will accumulate without bound. For a community club with photo galleries, match reports, etc., this could grow to several GB over years.

**Remediation:** Add a lifecycle policy to transition old uploads to Infrequent Access:

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

### 9. ECR lifecycle policy is too aggressive

**File:** `infra/environments/shared/main.tf` (lines 51-70)

The ECR lifecycle policy keeps only the last 10 images. With both staging and production deploying on every push to main, plus manual pushes, 10 images could represent as few as 5 deployments. This limits rollback capability.

**Remediation:** Increase to 25-30 images:

```hcl
countNumber = 25
```

### 10. Frontend deployment rebuilds in production job

**File:** `.github/workflows/deploy-web.yml` (lines 71-111)

The production job runs `pnpm install` and `pnpm --filter web build` again from scratch, rather than reusing the staging build artifact. This is slower and creates a theoretical risk of non-deterministic builds (different output between staging and production). For a Vite SPA with different `VITE_API_URL` values, a rebuild is technically necessary, but the install step could be cached.

**Remediation:** This is acceptable given the different `VITE_API_URL` values. However, add a build artifact cache or use GitHub Actions artifact upload/download to at least share the `node_modules` between jobs.

### 11. Monitoring dashboard has hardcoded region

**File:** `infra/modules/monitoring/main.tf` (lines 269, 288, etc.)

The CloudWatch dashboard JSON has `"region": "eu-west-2"` hardcoded in multiple widget properties. This should use a variable or data source.

**Remediation:** Add `data "aws_region" "current" {}` and use interpolation, or accept the hardcoding since this project is exclusively eu-west-2.

### 12. No CloudFront Origin Shield

**File:** `infra/modules/cdn/main.tf` (lines 184-302)

CloudFront Origin Shield is not enabled. For this workload, Origin Shield would reduce origin requests (to S3 and ALB) during cache misses by consolidating them through a single cache layer. The cost is minimal (~$0.0090 per 10,000 requests) and it would reduce ALB load.

**Remediation:** Add origin shield to the S3 origins:

```hcl
origin {
  domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
  origin_id                = local.frontend_origin_id
  origin_access_control_id = aws_cloudfront_origin_access_control.s3.id

  origin_shield {
    enabled              = true
    origin_shield_region = "eu-west-2"
  }
}
```

This is optional and low priority for this traffic level.

## Low Priority / Recommendations

### 13. VPC CIDR /16 is oversized

**File:** `infra/modules/vpc/main.tf` (line 15), `infra/environments/production/main.tf` (line 52)

A /16 CIDR provides 65,536 IP addresses. Each /24 subnet provides 254 usable IPs. With 2 AZs and 4 subnets total, this is far more than needed but causes no harm. Fargate tasks each consume one ENI (one IP) from the subnet.

**No action required.** This is standard practice and provides room for future expansion. Noted only for completeness.

### 14. Consider RDS Performance Insights

**File:** `infra/modules/rds/main.tf` (lines 127-155)

RDS Performance Insights is free for 7 days of retention on all instance types. It provides significantly better database diagnostics than CloudWatch metrics alone (top SQL, wait events).

**Remediation:** Add to the RDS instance:

```hcl
performance_insights_enabled          = true
performance_insights_retention_period = 7  # free tier
```

### 15. Terraform apply workflow has no plan-before-apply on merge

**File:** `.github/workflows/terraform.yml` (lines 70-104)

The `apply` job runs `terraform apply -auto-approve` directly on push to main without first running a plan. While the PR workflow shows a plan, the state could have drifted between PR approval and merge.

**Remediation:** Add a plan step before apply, or at minimum use `-input=false` (already implied by `-auto-approve`). For this project size, the current approach is acceptable but consider adding plan output to the workflow logs.

### 16. deploy-api.yml migration task uses old image

**File:** `.github/workflows/deploy-api.yml` (lines 77-116, 165-205)

The migration step runs using the *current* task definition (which still references the old image) rather than the newly built image. This means migrations run against the old container. If a migration depends on code in the new image, it will fail or use stale code.

**Remediation:** Register the new task definition *before* running migrations, or ensure the migration script (`packages/db/scripts/migrate-up.js`) is self-contained and does not depend on API application code changes in the same deploy. Given that the migration script is a standalone Kysely migrator, this is likely fine in practice, but the ordering is fragile.

### 17. Consider adding S3 bucket versioning for uploads

**File:** `infra/modules/cdn/main.tf` (lines 116-155)

The uploads bucket has no versioning enabled. If a user or admin accidentally overwrites or deletes an upload, it is permanently lost.

**Remediation:**

```hcl
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

Combined with a lifecycle rule to expire old versions after 30 days, this provides a safety net at minimal cost.

### 18. Staging ECS tasks run in public subnets

**File:** `infra/environments/staging/main.tf` (lines 77-84)

Staging passes `module.vpc.public_subnet_ids` as `private_subnet_ids` to the ECS module to avoid NAT Gateway costs. This is a clever cost optimization but means staging ECS tasks have public IPs and are directly addressable (though the security group restricts ingress to ALB only). This is an acceptable trade-off for staging.

**No action required.** Documented here for awareness. The security group rules properly restrict access.

## What's Done Well

1. **Right-sized for the workload.** The choice of `db.t4g.micro`, 256 CPU / 512 MB Fargate tasks, and ARM64 architecture is excellent for a community sports club. This avoids the common trap of over-provisioning small workloads.

2. **Cost-conscious staging environment.** Staging skips the NAT Gateway (~$35/month saved), uses 1 task instead of 2, and has shorter log retention. The `enable_nat_gateway` variable and `assign_public_ip` pattern is a clean way to handle this.

3. **S3 Gateway VPC endpoint.** The free S3 VPC endpoint (vpc/main.tf line 293) reduces NAT Gateway data transfer costs and improves performance for ECR image pulls and CloudWatch Logs.

4. **CloudFront PriceClass_100.** Using `PriceClass_100` (cdn/main.tf line 187) limits edge locations to North America and Europe, which is appropriate for a UK-based sports club and avoids unnecessary edge location costs.

5. **Proper ALB-to-ECS security group chain.** The security group rules correctly restrict ECS ingress to ALB only (vpc/main.tf line 235) and RDS ingress to ECS only (line 266). This is a proper tiered security model.

6. **Container Insights enabled.** ECS Container Insights (ecs-service/main.tf line 129) provides per-task metrics without additional configuration.

7. **Comprehensive monitoring.** The monitoring module covers all key metrics (ECS CPU/memory, ALB 5xx/unhealthy hosts, RDS CPU/storage/connections) with a CloudWatch dashboard. For this workload, the coverage is thorough.

8. **Sensible deployment pipeline.** The staging-then-production deployment with GitHub environment protection rules, migrations-before-deploy ordering, and ECS wait-for-stability is a solid pipeline for a small team.

9. **Clean module separation.** The module structure (vpc, rds, ecs-service, cdn, dns, monitoring, scheduling) is well-factored with clear variable interfaces and no circular dependencies.

10. **Accurate cost estimate.** The deployment plan's cost estimate (~$87/month production, ~$43/month staging) is realistic and demonstrates deliberate cost awareness. The ~$130/month total is very reasonable for this architecture.
