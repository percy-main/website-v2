# Security Review

## Summary

This review covers ~3500 lines of Terraform infrastructure, three GitHub Actions CI/CD workflows, and a deployment plan for migrating the Percy Main community sports club website to AWS. The infrastructure design is fundamentally sound -- proper VPC segmentation, private subnets for databases, Secrets Manager for credentials, OIDC for CI/CD auth, and encryption at rest for RDS. However, there are several significant issues: the Terraform role has AdministratorAccess, the CloudFront-to-ALB origin uses HTTP (not HTTPS), S3 buckets lack server-side encryption configuration, the ALB has no access logging, and the deploy role's ECS policy uses `Resource: "*"`. These should be addressed before production deployment.

## Critical Issues

### C1. Terraform IAM role has AdministratorAccess

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 145-148

```hcl
resource "aws_iam_role_policy_attachment" "terraform_admin" {
  role       = aws_iam_role.terraform.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
```

The Terraform role, assumable via OIDC from **any branch** of the repository (line 129: `repo:${var.github_repo}:*`), has full `AdministratorAccess`. This means any pull request workflow running `terraform plan` has the ability to execute arbitrary AWS API calls with admin privileges. A compromised PR or a malicious contributor could exfiltrate secrets, create backdoor IAM users, or destroy infrastructure.

**Remediation:**
1. Create a scoped IAM policy limited to the specific AWS services Terraform manages (VPC, ECS, RDS, S3, CloudFront, Route 53, IAM with path restrictions, ACM, SES, CloudWatch, Secrets Manager, ECR, EventBridge).
2. Tighten the OIDC trust policy for the Terraform role. Use `StringEquals` with specific branch refs instead of `StringLike` with wildcard `*`. At minimum, restrict plan-only access for PRs and apply access for `main` only. Consider separate roles for plan vs. apply.

### C2. CloudFront-to-ALB origin uses HTTP (unencrypted)

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 216-222

```hcl
custom_origin_config {
  http_port              = 80
  https_port             = 443
  origin_protocol_policy = "http-only"
  origin_ssl_protocols   = ["TLSv1.2"]
}
```

Traffic from CloudFront to the ALB is sent over plain HTTP. Even though this is within AWS infrastructure, the traffic traverses the public internet between CloudFront edge nodes and the ALB. API requests containing authentication tokens, session cookies, and sensitive user data (Stripe payments, Google OAuth tokens) are transmitted unencrypted on this hop.

**Remediation:** Change `origin_protocol_policy` to `"https-only"`. The ALB already has a valid ACM certificate and HTTPS listener configured, so this is a configuration-only change.

### C3. Terraform state backend is commented out (local state)

**Files:**
- `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 11-17
- `/Users/alexyoung/main2/website-v2/infra/environments/production/main.tf`, lines 14-21
- `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, lines 15-22

All three environments have the S3 backend commented out. While the deployment plan documents this as intentional (bootstrap ordering), there is a risk that this gets merged and applied with local state. Local state files contain all secrets in plaintext (RDS passwords, secret ARNs) and provide no locking, meaning concurrent applies could corrupt infrastructure.

**Remediation:** Ensure the bootstrap process is completed and backends are uncommented before any production use. Consider adding a CI check that fails if backend blocks are still commented out. At minimum, add `.terraform/` and `*.tfstate*` to `.gitignore` to prevent accidental state file commits.

## High Priority

### H1. Deploy role ECS policy uses `Resource: "*"`

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 218-232

```hcl
data "aws_iam_policy_document" "deploy_ecs" {
  statement {
    sid    = "ECSDeployService"
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
      "ecs:RunTask",
      "ecs:DescribeTasks",
    ]
    resources = ["*"]
  }
}
```

The deploy role can `RegisterTaskDefinition`, `RunTask`, and `UpdateService` on **any** ECS cluster in the account. An attacker with access to the deploy role could register a malicious task definition and run it, or hijack other ECS services.

**Remediation:** Scope resources to the specific clusters and services:
```hcl
resources = [
  "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:cluster/percy-main-*",
  "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:service/percy-main-*/percy-main-*",
  "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/*-api:*",
  "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/percy-main-*/*",
]
```

### H2. SES policy on task role uses `Resource: "*"`

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 216-233

```hcl
resource "aws_iam_role_policy" "task_ses" {
  ...
  policy = jsonencode({
    ...
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
    }]
  })
}
```

The ECS task role can send email from **any** SES identity in the account. If the application is compromised, an attacker could send phishing emails from any verified identity.

**Remediation:** Restrict to the specific SES identity ARN:
```hcl
Resource = "arn:aws:ses:eu-west-2:${data.aws_caller_identity.current.account_id}:identity/notifications.percymain.org"
```

### H3. ECR image tag mutability allows tag overwriting

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, line 44

```hcl
image_tag_mutability = "MUTABLE"
```

Mutable tags mean anyone with push access can overwrite an existing image tag (including `latest` or a specific SHA). This is a supply chain risk -- a compromised CI pipeline or stolen credentials could replace a known-good image with a malicious one.

**Remediation:** Set `image_tag_mutability = "IMMUTABLE"`. This requires that each deploy pushes a unique tag (the workflow already uses `${{ github.sha }}`), but the `latest` tag push in `deploy-api.yml` line 57 would need to be removed.

### H4. S3 buckets lack server-side encryption configuration

**Files:**
- `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 71-77 (frontend bucket)
- `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 116-122 (uploads bucket)

Neither S3 bucket has an `aws_s3_bucket_server_side_encryption_configuration` resource. While AWS now encrypts S3 with SSE-S3 by default, explicitly configuring encryption (ideally with SSE-KMS) is a compliance best practice and ensures the policy is codified.

**Remediation:** Add encryption configuration for both buckets:
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

### H5. ALB has no access logging enabled

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 322-330

The ALB resource has no `access_logs` block. ALB access logs are critical for security incident investigation, forensics, and compliance auditing. Without them, you have no record of which IPs accessed the API, request patterns, or evidence of attacks.

**Remediation:** Create an S3 bucket for ALB logs and enable access logging:
```hcl
resource "aws_lb" "main" {
  ...
  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "alb"
    enabled = true
  }
}
```

### H6. No WAF configured for CloudFront or ALB

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, line 188

```hcl
web_acl_id = var.waf_acl_arn != "" ? var.waf_acl_arn : null
```

The WAF variable defaults to empty string (line 24) and neither production nor staging passes a WAF ACL. The application handles Stripe webhooks and authentication -- without WAF, there is no protection against common web attacks (SQL injection, XSS, bot traffic, DDoS at the application layer).

**Remediation:** Create an `aws_wafv2_web_acl` resource with at minimum the AWS managed rule groups `AWSManagedRulesCommonRuleSet` and `AWSManagedRulesKnownBadInputsRuleSet`. Attach it to the CloudFront distribution. For a community sports club, the free tier of AWS WAF managed rules provides significant protection at minimal cost.

### H7. SNS topic for alarms is not encrypted

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`, lines 66-69

The SNS topic lacks a `kms_master_key_id` setting. Alarm notifications could contain sensitive operational information.

**Remediation:** Add KMS encryption:
```hcl
resource "aws_sns_topic" "alarms" {
  name              = "${local.prefix}-alarms"
  kms_master_key_id = "alias/aws/sns"
  tags              = local.default_tags
}
```

## Medium Priority

### M1. Staging ECS tasks run in public subnets with public IPs

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, lines 84, 91

```hcl
private_subnet_ids    = module.vpc.public_subnet_ids  # Note: actually public subnets
...
assign_public_ip      = true
```

Staging ECS tasks are placed in public subnets with public IP addresses. While the security group restricts ingress to ALB-originated traffic on port 3000, the tasks are directly addressable from the internet. Any vulnerability in the container or misconfigured security group rule would expose the application directly.

**Remediation:** This is documented as a cost-saving measure (no NAT gateway). Accept the risk for staging, but ensure security group rules remain tight. Consider adding a VPC flow log for the staging VPC to detect unexpected traffic patterns.

### M2. RDS password stored in Terraform state

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 72-76, 139

```hcl
resource "random_password" "db" {
  length = 32
  ...
}
...
password = random_password.db.result
```

The randomly generated RDS password is stored in plaintext in the Terraform state file. While the S3 backend (once enabled) will encrypt state at rest, anyone with read access to the state bucket can extract the database password.

**Remediation:** Consider using `aws_rds_cluster` with `manage_master_user_password = true` (RDS-managed secrets via Secrets Manager) to keep the password out of Terraform state entirely. Alternatively, ensure the state bucket has a restrictive bucket policy and that the KMS key used for state encryption has a tight key policy.

### M3. CloudFront custom error responses may leak information

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 265-277

```hcl
custom_error_response {
  error_code         = 403
  response_code      = 200
  response_page_path = "/index.html"
}
custom_error_response {
  error_code         = 404
  response_code      = 200
  response_page_path = "/index.html"
}
```

Rewriting 403/404 to 200 with `index.html` is standard for SPAs, but it also masks S3 access-denied errors for paths under `/uploads/*` and `/api/*`. An attacker probing for files in the uploads bucket will always get a 200 response with the SPA shell, making it harder to distinguish between existing and non-existing resources but also hiding legitimate access control failures from monitoring.

**Remediation:** Consider scoping the custom error responses. Since `/api/*` and `/uploads/*` have their own cache behaviors, the SPA fallback should ideally only apply to the default (frontend) behavior. CloudFront does not natively support per-behavior error pages, so document this as a known limitation. Ensure the API returns proper error codes that CloudFront passes through (which it will, since the API behavior uses `caching_disabled`).

### M4. ECR lifecycle policy is aggressive -- only keeps 10 images

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 51-70

Keeping only 10 images limits rollback capability. If deployments are frequent (multiple per day), you could lose the ability to roll back to a version from a few days ago.

**Remediation:** Increase to 25-50 images, or use a tag-based policy that keeps tagged images longer:
```hcl
{
  rulePriority = 1
  description  = "Keep last 30 images"
  selection = {
    tagStatus   = "any"
    countType   = "imageCountMoreThan"
    countNumber = 30
  }
  action = { type = "expire" }
}
```

### M5. Deploy workflow uses `continue-on-error: true` for Terraform plan

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/terraform.yml`, line 49

```yaml
- name: Terraform Plan
  id: plan
  ...
  continue-on-error: true
```

While the plan output is posted to the PR and there is a subsequent step to check the exit code (line 67), the `continue-on-error` pattern means the job shows as "green" initially even when the plan fails. Reviewers may miss a failed plan if they only glance at the status check.

**Remediation:** The current pattern (continue + check) is a common Terraform PR workflow pattern and is technically correct. However, ensure the "Check plan status" step is not accidentally removed in future changes.

### M6. CloudFront distribution lacks logging

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 184-302

The CloudFront distribution has no `logging_config` block. CloudFront access logs provide valuable security telemetry (client IPs, request URIs, response codes, edge locations).

**Remediation:** Add a logging configuration:
```hcl
logging_config {
  include_cookies = false
  bucket          = aws_s3_bucket.cdn_logs.bucket_domain_name
  prefix          = "cloudfront/"
}
```

### M7. No VPC Flow Logs enabled

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/vpc/main.tf`

The VPC module does not enable VPC Flow Logs. Flow logs are essential for network-level security monitoring, detecting unauthorized access attempts, and forensic analysis.

**Remediation:** Add a VPC Flow Log resource:
```hcl
resource "aws_flow_log" "main" {
  vpc_id               = aws_vpc.main.id
  traffic_type         = "ALL"
  log_destination      = aws_cloudwatch_log_group.vpc_flow_logs.arn
  log_destination_type = "cloud-watch-logs"
  iam_role_arn         = aws_iam_role.flow_log.arn
}
```

### M8. Terraform apply runs with `-auto-approve` without plan artifact pinning

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/terraform.yml`, line 104

```yaml
run: terraform apply -auto-approve
```

The apply step does not use a saved plan file. Between the time a PR was reviewed (with its plan output) and the merge to `main`, infrastructure could have changed. The actual apply may execute different changes than what was reviewed.

**Remediation:** Save the plan as an artifact during the PR phase, then download and apply that exact plan on merge. This ensures what was reviewed is what gets applied.

### M9. Production RDS is not Multi-AZ

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/production/main.tf`, line 65

```hcl
multi_az = false
```

While this is a cost decision, single-AZ RDS means a complete database outage during AZ failure or maintenance windows. For a production system handling payments (Stripe), this is a significant availability risk.

**Remediation:** Enable `multi_az = true` for production. The cost increase (~$13/month for db.t4g.micro) is minimal relative to the risk of payment processing downtime.

## Low Priority / Recommendations

### L1. OIDC thumbprint is hardcoded

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, line 109

```hcl
thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
```

GitHub's OIDC thumbprint can change when they rotate their TLS certificates. AWS now validates OIDC tokens without relying on the thumbprint for GitHub Actions, but the field is still required. This is a low risk since AWS handles GitHub OIDC specially, but consider using a data source or noting this in comments for maintainability.

### L2. Uploads bucket CORS allows wildcard origin as fallback

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 160-166

```hcl
allowed_origins = var.domain_name != "" ? ["https://${var.domain_name}"] : ["*"]
```

When `domain_name` is empty, CORS allows any origin. Both production and staging pass a domain name, so this is not currently exploitable, but the fallback is unnecessarily permissive.

**Remediation:** Remove the wildcard fallback or default to an empty list.

### L3. RDS `backup_retention_period` could be longer for production

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, line 147

```hcl
backup_retention_period = 7
```

Seven days of backups is the minimum recommended. For a system handling payments and membership data, 14-35 days provides better protection against delayed discovery of data corruption or accidental deletion.

### L4. No `deletion_protection` on RDS instance

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 127-155

The RDS instance does not set `deletion_protection = true`. A `terraform destroy` or misconfigured Terraform change could delete the production database.

**Remediation:** Add `deletion_protection = true` for production:
```hcl
deletion_protection = var.environment == "production" ? true : false
```

### L5. ECS task definition changes are ignored in lifecycle

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 420-422

```hcl
lifecycle {
  ignore_changes = [task_definition]
}
```

This is intentional (CI/CD updates the task definition outside Terraform), but it means Terraform will never detect or correct drift in the task definition. If someone manually modifies the task definition with overly permissive settings, Terraform will not revert it.

**Remediation:** Document this as a known operational pattern. Ensure CloudTrail is enabled to audit task definition changes.

### L6. Consider adding `aws_s3_bucket_versioning` to uploads bucket

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 116-122

The uploads bucket does not have versioning enabled. If user-uploaded content is accidentally deleted or overwritten, there is no recovery path.

### L7. Deploy workflow does not run tests before deploying

**Files:**
- `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-api.yml`
- `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-web.yml`

Neither deploy workflow runs the test suite before deploying. A push to `main` that passes lint/typecheck but has failing tests would still deploy.

**Remediation:** Add a test job as a prerequisite for the deploy jobs, or require a separate CI workflow to pass before deployment is allowed.

### L8. Secrets Manager secret lacks automatic rotation

**Files:**
- `/Users/alexyoung/main2/website-v2/infra/environments/production/secrets.tf`
- `/Users/alexyoung/main2/website-v2/infra/environments/staging/secrets.tf`

The application secrets are stored in Secrets Manager but have no rotation configuration. Long-lived secrets (especially `BETTER_AUTH_SECRET`, `STRIPE_SECRET_KEY`) increase the window of exposure if compromised.

**Remediation:** For RDS credentials, enable Secrets Manager automatic rotation. For third-party API keys (Stripe, Google), document a manual rotation procedure and schedule periodic reviews.

### L9. CloudWatch log group lacks KMS encryption

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 113-118

Application logs may contain sensitive data (user IDs, error details). The log group does not specify a `kms_key_id` for encryption.

**Remediation:** Add a KMS key for log group encryption:
```hcl
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.environment}-api"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.log_encryption_key_arn
  tags              = local.tags
}
```

## What's Done Well

1. **OIDC authentication for CI/CD** -- No long-lived AWS access keys in GitHub. Both Terraform and deploy roles use OIDC federation with proper audience validation.

2. **Deploy role is scoped to main branch** -- The deploy role trust policy (line 167) uses `StringEquals` with `ref:refs/heads/main`, preventing deploy actions from feature branches.

3. **RDS in private subnets, not publicly accessible** -- The database is correctly placed in private subnets with `publicly_accessible = false` and security group ingress limited to the ECS security group.

4. **Secrets stored in AWS Secrets Manager** -- Application secrets are stored in Secrets Manager and injected into ECS tasks at runtime via `valueFrom`, not as plaintext environment variables in the task definition.

5. **RDS storage encryption enabled** -- `storage_encrypted = true` is set on the RDS instance (line 135).

6. **ECR image scanning on push** -- `scan_on_push = true` provides automatic vulnerability scanning of container images.

7. **ALB HTTP-to-HTTPS redirect** -- The ALB HTTP listener (port 80) redirects to HTTPS with a 301, ensuring all client traffic is encrypted.

8. **TLS 1.3 policy on ALB** -- The HTTPS listener uses `ELBSecurityPolicy-TLS13-1-2-2021-06`, which enforces TLS 1.2 minimum with TLS 1.3 support.

9. **CloudFront viewer protocol policy** -- All cache behaviors use `redirect-to-https`, ensuring end-user connections are always encrypted.

10. **S3 public access blocks** -- Both S3 buckets have all four public access block settings enabled, preventing accidental public exposure.

11. **Origin Access Control (OAC) for S3** -- CloudFront uses OAC (not the legacy OAI) with SigV4 signing, and S3 bucket policies are scoped to the specific CloudFront distribution ARN.

12. **RDS logging parameters** -- The parameter group enables connection logging and slow query logging (`log_min_duration_statement = 1000ms`), providing audit and performance telemetry.

13. **Container Insights enabled** -- The ECS cluster has Container Insights enabled for detailed container-level monitoring.

14. **GitHub environment protection** -- The production deploy job references a `production` environment, and the deployment plan instructs enabling required reviewers.

15. **Comprehensive monitoring** -- CloudWatch alarms cover CPU, memory, 5xx errors, unhealthy hosts, RDS connections, and storage space, with SNS notifications.

16. **Security group rules are well-scoped** -- ECS ingress is limited to the ALB security group on port 3000 only. RDS ingress is limited to the ECS security group on port 5432 only. No overly broad ingress rules.
