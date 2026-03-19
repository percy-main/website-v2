# Reliability Review

## Summary

This infrastructure branch delivers a well-structured, cost-conscious Terraform setup for a community sports club website. The module decomposition is clean and the deployment plan is thorough. However, there are several reliability gaps -- most notably around database high availability (production RDS is single-AZ), NAT Gateway redundancy (single instance creates a cross-AZ failure domain), missing auto-scaling, no deployment circuit breaker, and incomplete rollback automation. The issues below are ordered by blast radius and likelihood of causing an outage.

## Critical Issues

### C1. Production RDS is single-AZ -- database is a single point of failure

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/production/main.tf`, line 65

```hcl
multi_az = false
```

Production database has no standby replica. An AZ failure, underlying hardware issue, or RDS maintenance event will cause full downtime with no automatic failover. RDS single-AZ maintenance windows also cause brief outages during patching.

**Remediation:** Set `multi_az = true` for the production environment. This adds approximately $13/month but provides automatic failover (typically 60-120 seconds) and zero-downtime patching. This is the single most impactful reliability improvement available.

---

### C2. Single NAT Gateway creates a cross-AZ failure domain

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/vpc/main.tf`, lines 107-127

The NAT Gateway is provisioned in a single AZ (`aws_subnet.public[0]`). If `eu-west-2a` experiences an outage, all ECS tasks in private subnets across both AZs lose outbound internet connectivity. This means the API cannot reach Stripe, Google OAuth, Play Cricket, SES, or any external service.

**Remediation:** For production, provision one NAT Gateway per AZ with per-AZ private route tables. Add a variable like `single_nat_gateway` (default true for staging, false for production):

```hcl
resource "aws_nat_gateway" "main" {
  count         = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : length(var.availability_zones)) : 0
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
}
```

Each private subnet should route through the NAT in its own AZ. This adds roughly $35/month but eliminates the cross-AZ dependency.

---

### C3. Migrations run before new image is deployed but use the OLD task definition

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-api.yml`, lines 77-116

The migration step fetches the *current* service task definition (line 78-82) and runs migrations using that old image. This means:

1. If a migration requires new application code that only exists in the new image, it will fail.
2. If a migration is backwards-incompatible, the currently running old tasks will break while the migration runs but before the new code deploys.

**Remediation:** Register the new task definition *first*, then run migrations using the new task definition (with the new image). Only after migrations succeed should the ECS service be updated. Restructure the deploy job to: (1) register new task def, (2) run migrations with new task def, (3) update service to new task def.

---

### C4. No ECS deployment circuit breaker -- failed deploys hang indefinitely

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 399-425

The ECS service definition lacks a `deployment_circuit_breaker` block. If a new task definition is broken (crashes on startup, fails health checks), ECS will continuously attempt to launch failing tasks. The `aws ecs wait services-stable` in the CI/CD workflow will eventually time out after 40 minutes, but the service remains in a degraded state requiring manual intervention.

**Remediation:** Add deployment circuit breaker with rollback:

```hcl
resource "aws_ecs_service" "api" {
  # ... existing config ...

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}
```

This causes ECS to automatically roll back to the previous working task definition if the new one fails health checks.

---

### C5. No `deployment_maximum_percent` / `deployment_minimum_healthy_percent` configured

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 399-425

The ECS service uses default deployment configuration (100% minimum healthy, 200% maximum). While these defaults are reasonable, they are not explicitly declared, making the deployment behavior implicit. More importantly, with `task_count = 2` in production, a rolling deployment will briefly run 4 tasks (200% of 2). With 256 CPU / 512 MB per task, this is fine, but it should be explicit.

**Remediation:** Add explicit deployment configuration:

```hcl
deployment_minimum_healthy_percent = 100
deployment_maximum_percent         = 200
```

---

## High Priority

### H1. No ECS auto-scaling configured

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`

The ECS service has a fixed `desired_count` with no auto-scaling policy. The monitoring module has CPU/memory alarms (lines 82-126 of monitoring/main.tf), but these only send notifications -- they do not trigger scaling. A traffic spike (e.g., match day, social media share going viral) will overwhelm 2 fixed tasks.

**Remediation:** Add an `aws_appautoscaling_target` and `aws_appautoscaling_policy` to the ECS service module:

```hcl
resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.max_task_count  # e.g. 6
  min_capacity       = var.task_count       # e.g. 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${local.name_prefix}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
```

---

### H2. ALB has no connection draining timeout or deregistration delay

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 336-356

The target group does not set `deregistration_delay`. The default is 300 seconds, which means during deployments, old tasks are kept alive for 5 minutes. This is reasonable but should be explicit. More importantly for a Fastify API that likely has short-lived requests, 300 seconds is excessive and slows deployments unnecessarily.

**Remediation:** Add explicit deregistration delay appropriate for the application:

```hcl
resource "aws_lb_target_group" "api" {
  # ... existing config ...
  deregistration_delay = 30
}
```

---

### H3. No S3 versioning on the uploads bucket -- data loss risk

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 116-155

Neither the frontend bucket nor the uploads bucket has versioning enabled. The frontend bucket is less concerning (rebuilt from source), but the uploads bucket contains user-generated content that cannot be recovered from source code.

**Remediation:** Enable versioning on the uploads bucket:

```hcl
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

Add a lifecycle rule to expire old versions after 30 days to control costs.

---

### H4. RDS backup retention is only 7 days with no cross-region backup

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, line 147

```hcl
backup_retention_period = 7
```

Seven days of automated backups is the bare minimum. There is no cross-region backup, no point-in-time recovery testing procedure, and no backup monitoring alarm. The `backup_window` and `maintenance_window` are not explicitly set, so AWS picks defaults that may overlap with peak usage.

**Remediation:**
- Increase `backup_retention_period` to at least 14 for production (costs are negligible for a 20 GB database).
- Set explicit `backup_window` and `maintenance_window` to off-peak hours:
  ```hcl
  backup_window      = "02:00-03:00"  # UTC, before 3am UK
  maintenance_window = "mon:03:00-mon:04:00"
  ```
- Add a CloudWatch alarm for `FreeableMemory` in the monitoring module.
- Consider enabling `copy_tags_to_snapshot = true`.

---

### H5. `ignore_changes = [task_definition]` undermines Terraform state accuracy

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 420-422

```hcl
lifecycle {
  ignore_changes = [task_definition]
}
```

This is a common pattern to prevent Terraform from reverting CI/CD-deployed task definitions, but it means `terraform plan` will never show drift in the task definition. If someone manually changes the task definition or a rollback occurs, Terraform has no visibility. This creates a split-brain between Terraform state and actual infrastructure.

**Remediation:** This is an accepted trade-off when CI/CD manages task definitions. Document this explicitly in a comment and consider also adding `desired_count` to `ignore_changes` so that auto-scaling changes (if added per H1) are not reverted by Terraform:

```hcl
lifecycle {
  ignore_changes = [task_definition, desired_count]
}
```

---

### H6. Terraform state backends are commented out -- local state is fragile

**Files:**
- `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 10-17
- `/Users/alexyoung/main2/website-v2/infra/environments/production/main.tf`, lines 14-21
- `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, lines 14-21

The S3 backend blocks are commented out with "Uncomment after bootstrap." The deployment plan documents this correctly, but until these are uncommented, all state is local. If the CI/CD `apply` job (terraform.yml line 104) runs with local state, it will see no existing resources and attempt to recreate everything, potentially causing data loss.

**Remediation:** The deployment plan covers this, but add a safeguard: the `terraform.yml` workflow should fail-fast if the backend is not configured (e.g., check for the `.terraform/terraform.tfstate` file after init and abort if backend is local).

---

### H7. Terraform apply runs on all environments with max-parallel: 1 but no dependency ordering guarantee

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/terraform.yml`, lines 70-104

The `apply` job uses `max-parallel: 1` with a matrix that has an `order` field, but GitHub Actions matrix strategy does not guarantee execution order based on a custom field. The `order` field is unused -- it is not referenced anywhere in the job steps. This means staging could be applied before shared, which would fail because staging depends on shared's remote state.

**Remediation:** Replace the matrix strategy with sequential jobs using `needs`:

```yaml
apply-shared:
  # ...
apply-staging:
  needs: apply-shared
  # ...
apply-production:
  needs: apply-staging
  environment: production
  # ...
```

---

## Medium Priority

### M1. CloudFront-to-ALB origin uses HTTP, not HTTPS

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 212-222

```hcl
origin_protocol_policy = "http-only"
```

Traffic between CloudFront and the ALB is unencrypted. While this traffic stays within AWS's network, it means the ALB's HTTPS listener (port 443) is unused for CloudFront traffic. If CloudFront's `api/*` path pattern is the only way users reach the API, the ALB's HTTPS certificate is effectively dead weight. However, the API subdomain DNS (`api.percymain.org`) points directly to the ALB, so direct API traffic IS encrypted.

The concern: traffic between CloudFront edge and ALB origin traverses the public internet (CloudFront PoP to ALB) over HTTP.

**Remediation:** Change to `https-only` or `match-viewer`:

```hcl
origin_protocol_policy = "https-only"
```

---

### M2. No WAF configured -- CloudFront `web_acl_id` defaults to null

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, line 188

```hcl
web_acl_id = var.waf_acl_arn != "" ? var.waf_acl_arn : null
```

Neither the production nor staging environment passes a WAF ACL ARN. The CloudFront distribution and ALB are unprotected against common web attacks (SQL injection, XSS, bot traffic, DDoS beyond basic CloudFront/Shield). For a site handling Stripe payments and user authentication, this is a notable gap.

**Remediation:** At minimum, attach AWS WAF with the `AWSManagedRulesCommonRuleSet` and `AWSManagedRulesKnownBadInputsRuleSet`. AWS WAF costs approximately $5/month + $0.60 per million requests.

---

### M3. DNS `evaluate_target_health` is false for CloudFront apex records

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/dns/main.tf`, lines 52-56 and 66-70

```hcl
evaluate_target_health = false
```

For the apex domain A/AAAA records pointing to CloudFront, health evaluation is disabled. If CloudFront or its origins become unhealthy, Route 53 will continue routing traffic to a broken endpoint. Note: for single-endpoint aliases (no failover routing policy), this has limited practical impact since there is no failover target. However, it should be `true` as a matter of principle -- it enables Route 53 health-check-aware routing if a failover record is added later.

The API subdomain records correctly use `evaluate_target_health = true` (lines 87, 101).

**Remediation:** Set `evaluate_target_health = true` for the CloudFront alias records.

---

### M4. No RDS storage auto-scaling

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, line 134

The RDS instance has `allocated_storage = 20` with no `max_allocated_storage` set. If the database grows beyond 20 GB, the instance will run out of storage and become read-only. The monitoring module has a `rds_free_storage_low` alarm (2 GB threshold), but this only alerts -- it does not prevent the outage.

**Remediation:** Enable storage auto-scaling:

```hcl
allocated_storage     = 20
max_allocated_storage = 100  # auto-scale up to 100 GB
```

---

### M5. ECR lifecycle policy is aggressive -- only 10 images retained

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 51-70

The ECR lifecycle policy keeps only 10 images. With two environments deploying from the same repository, 10 images represents roughly 5 deployments per environment. This limits rollback capability -- if an issue is discovered after 5 deployments, the known-good image may have been garbage collected.

**Remediation:** Increase to at least 25 images, or use a tag-based policy that retains images tagged with `production-*` or `staging-*` for longer.

---

### M6. No monitoring alarm for ALB target response time (latency)

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`

The monitoring module covers CPU, memory, 5xx errors, unhealthy hosts, RDS CPU, storage, and connections. Missing:
- **ALB `TargetResponseTime`** -- latency degradation is not detected
- **RDS `FreeableMemory`** -- memory pressure is not detected
- **RDS `ReadLatency` / `WriteLatency`** -- database performance issues are not detected
- **ECS `RunningTaskCount`** -- if tasks crash and are not replaced, there is no alarm

**Remediation:** Add at minimum:

```hcl
resource "aws_cloudwatch_metric_alarm" "alb_latency_high" {
  alarm_name          = "${local.prefix}-alb-latency-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 2  # 2 seconds p99
  # ...
}
```

---

### M7. Scheduled sync task has no dead-letter queue or failure alerting

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/scheduling/main.tf`, lines 116-156

The EventBridge Scheduler has no `dead_letter_config` configured. If the scheduled ECS task fails to launch (capacity issues, IAM permission errors, subnet exhaustion), the failure is silently lost. There is also no retry policy configured -- EventBridge Scheduler defaults to no retries for ECS targets.

**File:** `/Users/alexyoung/main2/website-v2/apps/api/src/sync-runner.ts`, lines 29-52

The sync runner exits with code 1 on failure but there is no mechanism to alert anyone. The ECS task logs go to CloudWatch, but there is no alarm on the log group for error patterns.

**Remediation:**
1. Add a dead-letter queue (SQS) to the scheduler:
   ```hcl
   dead_letter_config {
     arn = aws_sqs_queue.scheduler_dlq.arn
   }
   ```
2. Add a retry policy:
   ```hcl
   retry_policy {
     maximum_event_age_in_seconds = 3600
     maximum_retry_attempts       = 2
   }
   ```
3. Add a CloudWatch metric filter + alarm on the sync task log group for "Sync failed" or exit code 1.

---

### M8. Deploy workflow has no smoke test after deployment

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-api.yml`, lines 138-149

After updating the ECS service and waiting for stabilization, the workflow ends. There is no post-deployment health check or smoke test. The `services-stable` wait only confirms tasks are running and passing ALB health checks -- it does not verify the application is functionally correct (e.g., database connectivity, auth working, Stripe webhook reachable).

**Remediation:** Add a smoke test step after deployment:

```yaml
- name: Smoke test
  run: |
    for i in {1..5}; do
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://api.staging.percymain.org/health)
      if [ "$STATUS" = "200" ]; then
        echo "Health check passed"
        exit 0
      fi
      sleep 10
    done
    echo "Smoke test failed"
    exit 1
```

---

### M9. Frontend deploy has no rollback mechanism

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-web.yml`

The `aws s3 sync --delete` command is destructive -- it removes files from S3 that are not in the local build. If the new build is broken, there is no automated rollback. The only recovery is to re-run the workflow with a previous commit or manually upload old files.

**Remediation:** Enable S3 bucket versioning on the frontend bucket, and add a rollback step that can restore the previous version. Alternatively, deploy to a versioned prefix (e.g., `/v-<sha>/`) and update the CloudFront default root object or use a Lambda@Edge function for version routing.

---

## Low Priority / Recommendations

### L1. Only 2 Availability Zones -- consider adding a third

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/vpc/main.tf`, line 21

```hcl
default = ["eu-west-2a", "eu-west-2b"]
```

Two AZs is the minimum for high availability. A third AZ (`eu-west-2c`) would improve resilience against AZ-scoped failures and is required by some AWS services for best practices. The marginal cost is near zero (subnets are free). The main cost increase would be if you add a NAT Gateway per AZ.

---

### L2. RDS deletion protection is not enabled for production

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 127-155

There is no `deletion_protection = true` on the RDS instance. A `terraform destroy` or accidental resource removal in a Terraform plan could delete the production database. The `final_snapshot_identifier` is set (line 150), which helps, but prevention is better than recovery.

**Remediation:** Add a variable and enable for production:

```hcl
deletion_protection = var.environment == "production"
```

---

### L3. RDS password stored in Terraform state

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 72-76, 139

The `random_password` resource and its usage in `aws_db_instance.main.password` means the database password is stored in plaintext in the Terraform state file. When the S3 backend is enabled with encryption, this is acceptable, but it is worth noting. AWS now supports `manage_master_user_password = true` to have RDS manage its own credentials via Secrets Manager without Terraform ever seeing the password.

---

### L4. Terraform role has full AdministratorAccess

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 145-148

```hcl
policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
```

The Terraform OIDC role has full admin access, and the trust policy (line 129) uses `StringLike` with `repo:${var.github_repo}:*`, meaning ANY branch can assume this role. This is a security concern -- a compromised branch or PR from a fork could assume full admin access.

**Remediation:** Restrict the Terraform role's trust policy to specific branches:

```hcl
values = ["repo:${var.github_repo}:ref:refs/heads/main", "repo:${var.github_repo}:pull_request"]
```

And scope down the policy from `AdministratorAccess` to only the permissions Terraform actually needs.

---

### L5. Container has no resource limits (ulimits) or health check in task definition

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 277-313

The container definition does not include a `healthCheck` block. ECS relies solely on the ALB health check to determine container health. If the container is running but the process has hung (not accepting connections, not crashing), the ALB health check will eventually catch it, but a container-level health check would catch it faster.

**Remediation:** Add a container health check:

```json
"healthCheck": {
  "command": ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
  "interval": 30,
  "timeout": 5,
  "retries": 3,
  "startPeriod": 60
}
```

Note: this requires `curl` to be available in the container image, or use a Node.js-based health check script.

---

### L6. CloudWatch dashboard region is hardcoded

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`, lines 269, 287, etc.

```hcl
region = "eu-west-2"
```

The dashboard JSON hardcodes the region. If the infrastructure is ever deployed to a different region, the dashboard will show no data.

**Remediation:** Use `data.aws_region.current.name` and pass it into the dashboard JSON, or add a `region` variable.

---

### L7. No log-based metric filters for application errors

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`

The monitoring module only uses AWS-provided metrics (ECS, ALB, RDS). There are no CloudWatch Logs metric filters for application-level errors (unhandled exceptions, Stripe webhook failures, auth errors, database connection errors). These are often the first indicators of reliability issues.

---

### L8. Staging ECS tasks run in public subnets with public IPs

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, line 84

```hcl
private_subnet_ids = module.vpc.public_subnet_ids  # note: misleading parameter name
```

The staging ECS service passes `public_subnet_ids` to the `private_subnet_ids` parameter. This works but is confusing and means staging ECS tasks have public IP addresses, making them directly reachable from the internet (only blocked by the security group). This is an accepted cost trade-off to avoid the NAT Gateway, but the parameter naming is misleading.

---

### L9. SES not configured for bounce/complaint handling

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 76-100

SES domain identity is configured with DKIM, but there is no SNS topic for bounce or complaint notifications. AWS can suspend SES sending privileges if the bounce rate exceeds 5% or complaint rate exceeds 0.1%. For a membership management system sending transactional emails, bounce handling is important.

---

## What's Done Well

1. **Clean module decomposition.** Each infrastructure concern (VPC, RDS, ECS, CDN, DNS, monitoring, scheduling) is a separate module with clear inputs/outputs. This makes the infrastructure composable and testable.

2. **Security group isolation.** The VPC module properly segments ALB, ECS, and RDS security groups with minimal ingress rules (ALB -> ECS on port 3000, ECS -> RDS on port 5432). No overly permissive CIDR-based rules on internal services.

3. **S3 bucket hardening.** Both S3 buckets have public access blocks enabled and use CloudFront OAC for access control rather than bucket policies with public access.

4. **Secrets management.** Application secrets are stored in Secrets Manager and injected into ECS tasks via the `secrets` block in the container definition, rather than being passed as environment variables or stored in Terraform variables.

5. **Deploy role scoped to main branch.** The deploy IAM role (shared/main.tf lines 154-176) uses `StringEquals` on the OIDC subject to restrict assumption to the main branch only, preventing staging/feature branches from deploying.

6. **ECR image scanning enabled.** The ECR repository has `scan_on_push = true`, which will flag known CVEs in container images.

7. **HTTP-to-HTTPS redirect on ALB.** The ALB listener on port 80 properly redirects to HTTPS with a 301 status code.

8. **Container Insights enabled on ECS cluster.** This provides detailed per-container metrics beyond standard CloudWatch metrics.

9. **Comprehensive deployment plan.** The `docs/deployment-plan.md` is a well-written runbook covering bootstrap, apply order, DNS delegation, secret population, first deployment, rollback procedures, and cost estimates. This significantly reduces operational risk during initial setup.

10. **Staged deployment pipeline.** The API deployment workflow deploys to staging first, waits for stabilization, then deploys to production with an environment approval gate. This provides a safe promotion path.

11. **RDS storage encryption enabled.** The `storage_encrypted = true` flag ensures data at rest is encrypted.

12. **VPC endpoints for S3.** The Gateway VPC endpoint for S3 avoids NAT Gateway charges for ECR image pulls and CloudWatch log delivery.
