# AWS Best Practices Review

## Summary

This infrastructure represents a well-structured AWS deployment for a community sports club website, with good use of Terraform modules, proper separation of shared/staging/production environments, and sensible cost-conscious defaults (ARM64/Graviton, single NAT Gateway, small instance sizes). However, there are several critical security gaps (AdministratorAccess on the Terraform role, missing ECS deployment circuit breaker, no ALB access logs), important reliability gaps (production RDS is single-AZ with no read replica), and a number of medium-priority improvements needed around encryption, VPC endpoints, and S3 bucket hardening.

## Critical Issues

### C1. Terraform IAM role has AdministratorAccess

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 145-148

```hcl
resource "aws_iam_role_policy_attachment" "terraform_admin" {
  role       = aws_iam_role.terraform.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
```

The Terraform OIDC role trusts **all branches** of the repo (`repo:${var.github_repo}:*` on line 129). Combined with `AdministratorAccess`, any branch (including from a PR) can assume full admin privileges in the AWS account. An attacker who opens a PR modifying `infra/` could exfiltrate credentials or create backdoor resources during the `plan` job.

**Remediation:**
- Restrict the Terraform role's trust policy to `ref:refs/heads/main` only, or create a separate read-only plan role for PRs.
- Replace `AdministratorAccess` with a scoped policy that only allows the specific resources Terraform manages. At minimum, add a permissions boundary.

### C2. ECS deploy role has wildcard ECS permissions

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 218-232

```hcl
actions = [
  "ecs:UpdateService",
  "ecs:DescribeServices",
  "ecs:DescribeTaskDefinition",
  "ecs:RegisterTaskDefinition",
  "ecs:RunTask",
  "ecs:DescribeTasks",
]
resources = ["*"]
```

The deploy role can register arbitrary task definitions and run tasks in any ECS cluster in the account, not just percy-main clusters. This violates the principle of least privilege.

**Remediation:** Scope resources to specific cluster and service ARNs:
```hcl
resources = [
  "arn:aws:ecs:eu-west-2:${account_id}:cluster/percy-main-*",
  "arn:aws:ecs:eu-west-2:${account_id}:service/percy-main-*/*",
  "arn:aws:ecs:eu-west-2:${account_id}:task-definition/*-api:*",
  "arn:aws:ecs:eu-west-2:${account_id}:task/percy-main-*/*",
]
```

### C3. Missing ECS deployment circuit breaker

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 399-425

The ECS service has no `deployment_circuit_breaker` block. Without this, a bad deployment can cause ECS to loop indefinitely trying to place failing tasks, draining resources and potentially causing an outage.

**Remediation:** Add circuit breaker with rollback:
```hcl
deployment_circuit_breaker {
  enable   = true
  rollback = true
}
```

### C4. Production RDS is single-AZ (`multi_az = false`)

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/production/main.tf`, line 65

```hcl
multi_az = false
```

For a production database serving a membership and payments system, single-AZ RDS means any AZ failure causes a full database outage with manual recovery required. The RDS instance has no automatic failover capability.

**Remediation:** Set `multi_az = true` for the production environment. This adds approximately $13/month (doubling the db.t4g.micro cost) but provides automatic failover with typically < 60 seconds downtime.

### C5. RDS password stored in Terraform state in plaintext

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 72-76, 139

The `random_password` resource and `aws_db_instance.password` attribute store the database password in Terraform state in plaintext. If the S3 state bucket is compromised, all database credentials are exposed.

**Remediation:**
- Use `manage_master_user_password = true` on the RDS instance to let AWS manage the master password via Secrets Manager natively (available since AWS provider 5.x).
- Remove the `random_password` resource and manual Secrets Manager secret for DB credentials.
- Alternatively, ensure the state bucket uses KMS encryption with a customer-managed key and restrict access tightly.

### C6. SNS topic is not encrypted

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`, lines 66-69

The SNS alarm topic has no `kms_master_key_id` set. Alarm notifications (which may contain operational details) are stored and transmitted unencrypted at rest.

**Remediation:** Add KMS encryption:
```hcl
resource "aws_sns_topic" "alarms" {
  name              = "${local.prefix}-alarms"
  kms_master_key_id = "alias/aws/sns"
  tags              = local.default_tags
}
```

## High Priority

### H1. No ALB access logs enabled

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 322-330

The ALB has no `access_logs` block. ALB access logs are essential for security incident investigation, debugging, and compliance. Without them, you have no record of who accessed the API, request latencies, or error patterns at the load balancer level.

**Remediation:** Create an S3 bucket for ALB logs and add:
```hcl
access_logs {
  bucket  = aws_s3_bucket.alb_logs.id
  prefix  = "alb"
  enabled = true
}
```

### H2. No ALB deletion protection

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 322-330

The ALB has no `enable_deletion_protection = true`. An accidental `terraform destroy` or resource removal could delete the production load balancer.

**Remediation:** Add `enable_deletion_protection = true` for production, parameterize for staging:
```hcl
enable_deletion_protection = var.environment == "production"
```

### H3. No RDS deletion protection

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 127-155

The RDS instance has no `deletion_protection = true`. Combined with `skip_final_snapshot = false` for non-production, this creates risk of accidental data loss.

**Remediation:** Add deletion protection for production:
```hcl
deletion_protection = var.environment == "production"
```

### H4. CloudFront-to-ALB communication uses HTTP (not HTTPS)

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 216-222

```hcl
custom_origin_config {
  http_port              = 80
  https_port             = 443
  origin_protocol_policy = "http-only"
  origin_ssl_protocols   = ["TLSv1.2"]
}
```

Traffic between CloudFront and the ALB is sent over plain HTTP. While this traffic stays within AWS's network, it violates zero-trust principles and could expose sensitive data (auth tokens, payment information) if there is any network interception.

**Remediation:** Change to `origin_protocol_policy = "https-only"`. The ALB already has an HTTPS listener with a valid ACM certificate.

### H5. S3 buckets missing versioning

**Files:**
- `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 71-77 (frontend bucket)
- `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 116-122 (uploads bucket)

Neither the frontend nor uploads S3 bucket has versioning enabled. For the uploads bucket especially, user-uploaded content could be permanently lost if overwritten or deleted.

**Remediation:** Add versioning:
```hcl
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

### H6. S3 buckets missing server-side encryption configuration

**Files:**
- `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 71-77, 116-122

Neither S3 bucket has an explicit `aws_s3_bucket_server_side_encryption_configuration` resource. While S3 now encrypts by default with SSE-S3, explicitly declaring encryption is an AWS best practice for auditability and for enforcing a specific KMS key if needed.

**Remediation:** Add explicit encryption configuration:
```hcl
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}
```

### H7. SES task role allows sending to any identity (`Resource = "*"`)

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 216-233

```hcl
Action = [
  "ses:SendEmail",
  "ses:SendRawEmail"
]
Resource = "*"
```

The task role can send email from any SES identity in the account. If the application is compromised, it could be used to send spam from any verified identity.

**Remediation:** Scope to the specific SES identity ARN:
```hcl
Resource = "arn:aws:ses:eu-west-2:${account_id}:identity/notifications.percymain.org"
```

### H8. Terraform state backend is commented out

**Files:**
- `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 10-17
- `/Users/alexyoung/main2/website-v2/infra/environments/production/main.tf`, lines 14-21
- `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, lines 15-22

All three environments have the S3 backend commented out. While the deployment plan explains this is intentional for bootstrap, the Terraform CI workflow (`terraform.yml`) runs `terraform init` and `terraform apply` which will use local state if the backend is not configured. If anyone accidentally applies from CI before uncommenting, state will be lost.

**Remediation:** Add a validation step in the CI workflow that checks the backend is configured, or use partial backend configuration with `-backend-config` flags.

### H9. No WAF association for the ALB

The CloudFront distribution accepts an optional `waf_acl_arn`, but there is no WAF Web ACL defined anywhere in the infrastructure. The ALB is directly internet-facing with no WAF protection against common web attacks (SQL injection, XSS, bot traffic).

**Remediation:** Create an AWS WAF Web ACL with at minimum the AWS Managed Rules Core Rule Set and associate it with the ALB and/or CloudFront distribution.

## Medium Priority

### M1. Missing VPC Interface Endpoints for ECR and CloudWatch Logs

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/vpc/main.tf`, lines 290-306

Only an S3 Gateway endpoint is configured. ECS Fargate tasks in private subnets need to reach ECR (for image pulls) and CloudWatch Logs (for log shipping) through the NAT Gateway, which incurs data transfer costs.

**Remediation:** Add VPC Interface Endpoints for `ecr.api`, `ecr.dkr`, and `logs`. Note: Interface Endpoints cost ~$7.50/month each, so evaluate cost vs NAT data transfer savings. For a small deployment, the NAT Gateway may be cheaper.

### M2. Single NAT Gateway is a single point of failure

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/vpc/main.tf`, lines 104-127

There is one NAT Gateway in a single AZ. If that AZ has an outage, all private subnet resources in the other AZ lose internet connectivity (ECS tasks cannot pull images, reach external APIs, etc.).

**Remediation:** For production, consider deploying one NAT Gateway per AZ. This doubles NAT costs (~$35 to ~$70/month) but eliminates the single point of failure. For a community sports club, the current approach is a reasonable cost trade-off, but document this as an accepted risk.

### M3. No RDS Enhanced Monitoring enabled

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 127-155

The RDS instance has no `monitoring_interval` or `monitoring_role_arn` set. Enhanced Monitoring provides OS-level metrics (CPU, memory, file system, disk I/O) at up to 1-second granularity, which is crucial for diagnosing database performance issues.

**Remediation:**
```hcl
monitoring_interval = 60
monitoring_role_arn = aws_iam_role.rds_enhanced_monitoring.arn
```

### M4. No RDS Performance Insights enabled

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 127-155

Performance Insights is free for 7-day retention on most instance types and provides query-level performance analysis.

**Remediation:**
```hcl
performance_insights_enabled          = true
performance_insights_retention_period = 7
```

### M5. No auto-scaling for ECS service

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 399-425

The ECS service has a fixed `desired_count` with no Application Auto Scaling policy. During traffic spikes (e.g., match days), the service cannot scale up, and during quiet periods, it cannot scale down.

**Remediation:** Add an `aws_appautoscaling_target` and `aws_appautoscaling_policy` for CPU/memory-based scaling:
```hcl
resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = 4
  min_capacity       = var.task_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}
```

### M6. CloudWatch dashboard region is hardcoded

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`, lines 269, 287, 304, 320, 337, 354, 371

The dashboard body hardcodes `"region": "eu-west-2"` in every widget. This should use a data source or variable.

**Remediation:** Use `data.aws_region.current.name` via a local variable interpolated into the dashboard JSON, or accept a `region` variable.

### M7. ECR image tag mutability is MUTABLE

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, line 44

```hcl
image_tag_mutability = "MUTABLE"
```

Mutable tags mean the `latest` tag can be overwritten, which makes it impossible to guarantee which image version is deployed. If someone pushes a different image with the same tag, ECS could pull an unexpected version.

**Remediation:** Set `image_tag_mutability = "IMMUTABLE"`. The CI already tags images with `github.sha`, so immutability only prevents the `latest` tag from being overwritten (which is desirable). Note: this means the `latest` tag push in `deploy-api.yml` line 57 would need to be removed or changed.

### M8. No CloudWatch Log Group encryption

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 113-118

The CloudWatch Log Group has no `kms_key_id` set. Application logs may contain sensitive information (user emails, error traces with PII).

**Remediation:**
```hcl
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.environment}-api"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn  # pass in a KMS key ARN
  tags              = local.tags
}
```

### M9. RDS egress security group is overly permissive

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/vpc/main.tf`, lines 276-284

The RDS security group allows all outbound traffic (`0.0.0.0/0`). RDS instances typically do not need to initiate outbound connections.

**Remediation:** Remove the egress rule or restrict it to only necessary destinations (e.g., if using RDS Proxy or Lambda triggers). For a standard RDS instance with no outbound requirements, no egress rule is needed.

### M10. Deploy CI/CD workflow lacks smoke test after deployment

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-api.yml`, lines 138-149

After updating the ECS service and waiting for stability, there is no health check verification. `services-stable` only confirms tasks are running, not that the application is actually serving traffic correctly.

**Remediation:** Add a smoke test step:
```yaml
- name: Smoke test
  run: |
    for i in $(seq 1 10); do
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://api.staging.percymain.org/health)
      if [ "$STATUS" = "200" ]; then exit 0; fi
      sleep 5
    done
    echo "Smoke test failed"
    exit 1
```

### M11. Staging ECS tasks run in public subnets with public IPs

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, lines 84, 91

```hcl
private_subnet_ids    = module.vpc.public_subnet_ids  # misleading parameter name
assign_public_ip      = true
```

The parameter `private_subnet_ids` is being passed `public_subnet_ids`, which is confusing and means ECS tasks have public IP addresses. While this saves NAT Gateway costs, it exposes the task network interfaces directly to the internet. The security group restricts inbound to ALB-only, but this increases the attack surface.

**Remediation:** This is an acceptable cost trade-off for staging, but add a comment in the module explaining the security implication. Consider using NAT instances (cheaper than NAT Gateway) as an alternative.

### M12. `log_retention_days` variable declared but unused in monitoring module

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`, lines 18-20

The `log_retention_days` variable is declared but never used within the monitoring module. Log retention is actually configured in the ECS module.

**Remediation:** Remove the unused variable to avoid confusion.

## Low Priority / Recommendations

### L1. Consider RDS storage auto-scaling

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, line 134

The `allocated_storage` is fixed at 20GB with no `max_allocated_storage` set for auto-scaling. If the database grows beyond 20GB, manual intervention is needed.

**Remediation:**
```hcl
max_allocated_storage = 100  # allow auto-scaling up to 100GB
```

### L2. Consider adding a `backup_window` and `maintenance_window` for RDS

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 127-155

No explicit backup or maintenance windows are set. AWS will pick random windows, which could coincide with peak usage times (e.g., match day Saturday afternoons).

**Remediation:**
```hcl
backup_window      = "03:00-04:00"   # 3-4am UTC
maintenance_window = "mon:04:00-mon:05:00"
```

### L3. Consider CloudFront response headers policy

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 253-261

The default cache behavior has no `response_headers_policy_id`. Adding security headers (HSTS, X-Content-Type-Options, X-Frame-Options) at the CloudFront level provides defense-in-depth.

**Remediation:** Use the AWS managed `SecurityHeadersPolicy` or create a custom one:
```hcl
response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
```

### L4. Consider adding CloudFront logging

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 184-302

The CloudFront distribution has no `logging_config` block. Access logs help with debugging, usage analysis, and security auditing.

**Remediation:**
```hcl
logging_config {
  bucket          = aws_s3_bucket.cf_logs.bucket_domain_name
  prefix          = "cloudfront/"
  include_cookies = false
}
```

### L5. Add lifecycle policy for uploads bucket

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 116-122

The uploads bucket has no lifecycle policy. Old or unused uploads will accumulate indefinitely.

**Remediation:** Add a lifecycle rule to transition old objects to Infrequent Access or Glacier:
```hcl
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "transition-old-uploads"
    status = "Enabled"
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }
}
```

### L6. Consider using `for_each` instead of `count` for subnets

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/vpc/main.tf`, lines 64-89

Using `count` means that if an AZ is added or removed from the middle of the list, Terraform will recreate subnets (potentially destructive). Using `for_each` with a map keyed by AZ name is safer.

### L7. Pin GitHub Actions action versions to SHA, not just major version

**Files:** All three workflow files use `@v4`, `@v3`, `@v7` tags. These are mutable tags. A supply chain attack on any of these actions could compromise the CI pipeline.

**Remediation:** Pin to full commit SHAs:
```yaml
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
```

### L8. Add `Project` tag consistently to all resources

The `common_tags` in most modules include `Project = "percy-main"`, but the production `secrets.tf` (line 10-12) only has `Environment` and the staging `secrets.tf` (line 12-15) has all three. Be consistent.

### L9. Consider Savings Plans for Fargate

For the production ECS tasks running 24/7, a 1-year Compute Savings Plan could save up to 20% on Fargate costs. At ~$15/month this is modest, but worth considering as the deployment grows.

### L10. CloudWatch alarm for ALB target response time

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`

The monitoring module has no alarm for `TargetResponseTime`. High API latency is a common issue that should be alerted on before users notice.

**Remediation:** Add an alarm for P99 latency:
```hcl
resource "aws_cloudwatch_metric_alarm" "alb_response_time" {
  alarm_name          = "${local.prefix}-alb-response-time-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 2
  ...
}
```

## What's Done Well

1. **Graviton/ARM64 architecture** (ecs-service/main.tf line 275, deploy-api.yml line 53) -- Using ARM64 for both ECS tasks and the Docker build provides ~20% cost savings and better performance per watt. Well aligned with AWS sustainability best practices.

2. **Container Insights enabled** (ecs-service/main.tf lines 127-130) -- ECS Container Insights is enabled on the cluster, providing detailed per-task and per-service metrics without custom instrumentation.

3. **ECR image scanning on push** (shared/main.tf lines 46-48) -- Automated vulnerability scanning catches known CVEs in base images before deployment.

4. **ECR lifecycle policy** (shared/main.tf lines 51-70) -- Keeping only the last 10 images prevents unbounded storage growth and costs.

5. **S3 public access blocks** (cdn/main.tf lines 79-86, 124-131) -- Both S3 buckets properly block all public access and use CloudFront OAC for secure access.

6. **CloudFront Origin Access Control** (cdn/main.tf lines 172-178) -- Using the modern OAC (not the legacy OAI) for S3 origins with SigV4 signing.

7. **HTTPS redirect on ALB** (ecs-service/main.tf lines 362-378) -- HTTP port 80 properly redirects to HTTPS 443 with a 301 redirect.

8. **TLS 1.3 on ALB** (ecs-service/main.tf line 384) -- Using `ELBSecurityPolicy-TLS13-1-2-2021-06` which enforces TLS 1.2+ with TLS 1.3 support.

9. **TLS 1.2 minimum on CloudFront** (cdn/main.tf line 286) -- Using `TLSv1.2_2021` minimum protocol version.

10. **GitHub Actions OIDC** (shared/main.tf lines 106-110) -- Using OIDC federation instead of long-lived IAM access keys for CI/CD. No static credentials stored in GitHub secrets.

11. **Separate deploy and terraform IAM roles** (shared/main.tf lines 116-311) -- Deploy role is scoped to main branch only with limited permissions, separate from the Terraform role.

12. **RDS in private subnets** (rds/main.tf line 146, vpc/main.tf) -- Database is not publicly accessible and resides in private subnets with security group restricting access to ECS tasks only.

13. **Storage encryption on RDS** (rds/main.tf line 135) -- `storage_encrypted = true` ensures data at rest is encrypted.

14. **Secrets Manager for credentials** (rds/main.tf lines 161-180, secrets.tf) -- Database credentials and application secrets are stored in Secrets Manager, not in environment variables or Terraform variables.

15. **ECS tasks in private subnets (production)** (production/main.tf line 90) -- Production ECS tasks run in private subnets without public IPs, with internet access via NAT Gateway.

16. **Comprehensive monitoring** (monitoring/main.tf) -- CloudWatch alarms for ECS CPU/memory, ALB 5xx errors, ALB unhealthy hosts, RDS CPU, storage, and connections. Dashboard with key metrics.

17. **S3 VPC Gateway Endpoint** (vpc/main.tf lines 293-306) -- Free S3 Gateway endpoint reduces NAT Gateway data transfer costs and latency.

18. **Consistent tagging strategy** -- Nearly all resources are tagged with Environment, Project, ManagedBy, and Module tags.

19. **Well-structured deployment plan** (deployment-plan.md) -- The bootstrap runbook is thorough, covers manual steps, provides verification commands, and includes cost estimates.

20. **Cache-control headers for frontend deployment** (deploy-web.yml lines 46-58) -- Proper cache-busting strategy with immutable caching for hashed assets and no-cache for index.html.

21. **Sequential deploy pipeline** (deploy-api.yml) -- Staging deploys first, production requires separate approval via GitHub Environments, providing a gate before production changes.

22. **Terraform plan on PR** (terraform.yml) -- Infrastructure changes show a plan on pull requests before being applied, enabling review.

23. **Parameterized parameter group with slow query logging** (rds/main.tf lines 95-121) -- `log_min_duration_statement = 1000` logs queries taking over 1 second, aiding performance debugging.

24. **Sensible cost architecture** -- The overall design is cost-appropriate for a community sports club (~$130/month total), using smallest Graviton instances, single NAT Gateway, and skipping NAT in staging.
