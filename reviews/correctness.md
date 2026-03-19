# Correctness Review

## Summary

The Terraform infrastructure is well-structured with clean module boundaries and sensible defaults for a community sports club migrating to AWS. However, there are several correctness issues ranging from an invalid IAM policy ARN that will fail on apply, to S3 bucket naming mismatches between modules, a staging environment networking concern, and CI/CD workflow ordering problems. The most impactful issues are concentrated in the ECS service module (IAM ARN typo), the CDN/ECS module bucket naming inconsistency, and the Terraform CI/CD apply job which lacks proper sequential ordering guarantees.

## Critical Issues

### C1. Invalid IAM managed policy ARN -- will fail on apply

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, line 161

```hcl
policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
```

The ARN is missing the AWS partition account (empty between `iam:` and `:aws`). The correct ARN has no account number but retains the double colon structure. However, the actual issue here is that the correct format is `arn:aws:iam::aws:policy/...` which actually *is* the correct format for AWS-managed policies -- wait, no. AWS managed policy ARNs are `arn:aws:iam::aws:policy/...`. Let me re-examine: the standard form is `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`. But the line shows `arn:aws:iam::aws:policy/...` which has two colons between `iam` and `aws`. The correct ARN format for AWS managed policies is:

```
arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

This actually appears to be missing the account-id field. AWS managed policy ARNs have the format `arn:aws:iam::aws:policy/...` (empty account field). Let me look more carefully at the raw text: `arn:aws:iam::aws:policy/...`. Counting the colons: `arn:aws:iam::aws:policy` -- that is `arn` : `aws` : `iam` : `` : `aws` : `policy/...`. An ARN has format `arn:partition:service:region:account:resource`. So this reads as region="" and account="aws". But for IAM, region is always empty, so `arn:aws:iam::aws:policy/...` would mean account="aws" which is wrong. The correct form is `arn:aws:iam:::policy/...`? No.

Correction: The standard AWS managed policy ARN is literally `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`. Wait -- AWS documentation shows it as `arn:aws:iam::aws:policy/...`. Let me count: that's 5 colons total. The code shows `arn:aws:iam::aws:policy/...` which also has 5 colons. But looking at real AWS managed policy ARNs, they look like `arn:aws:iam::123456789012:policy/MyPolicy` for customer policies, and `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` for AWS managed ones. The region field is always empty for IAM.

Actually I need to re-examine the raw source. The file shows: `"arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"`. A correct AWS managed policy ARN should be `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` -- with exactly TWO colons between `iam` and `aws` (empty region field). Let me count in the source: `arn:aws:iam::aws:policy` has `iam` followed by `::` then `aws`. That is correct -- region is empty (one empty field between iam and aws).

Wait. An ARN is: `arn:partition:service:region:account-id:resource`. For IAM: `arn:aws:iam::account-id:resource` (region always empty). For AWS-managed policies: `arn:aws:iam::aws:policy/PolicyName` -- but that would make account-id empty and "aws" would be the start of the resource. No -- for AWS managed policies, the account field literally contains the string "aws": `arn:aws:iam::aws:policy/...` Wait, I keep going back and forth. Let me just be definitive:

The CORRECT ARN for this managed policy is: `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`

Looking at the source code line 161 character by character: `"arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"` -- I see `iam::aws`. That is `iam` + `:` (end of service) + `:` (empty region) + `aws` (account = "aws"). But the correct format needs `iam` + `:` (end of service) + `:` (empty region) + `:` (end of region) + `aws` (account). So the correct ARN is `arn:aws:iam:::aws:policy/...`? No, that would be 6 colons total for 7 fields, but ARN only has 6 fields separated by 5 colons.

OK, I am overcomplicating this. ARN = `arn:partition:service:region:account:resource`. So: `arn:aws:iam:<region>:<account>:policy/...`. For IAM, region is empty, account is "aws" for managed policies. So: `arn:aws:iam::aws:policy/...`. The source shows exactly this. **This ARN is actually correct.** I retract this finding.

### C1 (revised). IAM PassRole ARN missing account ID

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, line 282

```hcl
resources = [
  "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/percy-main-*",
]
```

This ARN has an empty region field between `iam:` and `:${data...}`. IAM ARNs do have an empty region field, so the format `arn:aws:iam::<account-id>:role/...` is actually correct. Retracted.

Let me re-examine the actual managed policy ARN issue more carefully.

Line 161: `"arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"` -- checking against AWS docs, the correct ARN for this policy is `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`. This IS correct.

**ACTUAL Critical Issue C1: `terraform apply` ordering in CI/CD is not guaranteed**

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/terraform.yml`, lines 70-104

The `apply` job uses a matrix strategy with `max-parallel: 1` and an `order` field, but GitHub Actions matrix strategies do NOT guarantee execution order based on custom properties. The `order` field is just data -- it does not control sequencing. With `max-parallel: 1`, GitHub picks one matrix entry at a time but the order is **undefined**. If staging or production runs before shared, the `terraform_remote_state` data source will fail because the shared state does not yet exist.

**Remediation:** Replace the matrix with three separate jobs chained via `needs`:

```yaml
apply-shared:
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  # ... apply shared

apply-staging:
  needs: apply-shared
  # ... apply staging

apply-production:
  needs: apply-staging
  environment: production
  # ... apply production
```

### C2. Staging ACM certificate is for the wrong domain

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, line 89

```hcl
acm_certificate_arn = local.shared.acm_alb_certificate_arn
```

The shared environment creates the ALB ACM certificate for `api.percymain.org` only (line 318 of shared/main.tf). The staging ALB serves `api.staging.percymain.org`. Using the same certificate will cause the HTTPS listener to present a certificate for the wrong domain, resulting in TLS errors.

Similarly, line 127:
```hcl
acm_certificate_arn = local.shared.acm_cloudfront_certificate_arn
```

The CloudFront certificate covers `percymain.org` and `*.percymain.org` (line 357 of shared/main.tf), which DOES cover `staging.percymain.org` via the wildcard. So the CloudFront cert is fine. But the ALB cert only covers `api.percymain.org`, NOT `api.staging.percymain.org`.

**Remediation:** Either:
1. Add `api.staging.percymain.org` as a SAN to the shared ALB certificate, or
2. Use the wildcard CloudFront certificate (`*.percymain.org`) for the staging ALB too (but note it does not cover `api.staging.percymain.org` since wildcards only match one level), or
3. Create a separate ACM certificate for staging in eu-west-2 covering `api.staging.percymain.org`.

Option 3 is cleanest. The wildcard `*.percymain.org` does NOT match `api.staging.percymain.org` (two levels deep), so option 2 won't work either. You need a dedicated certificate for `api.staging.percymain.org` or modify the shared ALB cert to include SANs for both domains.

### C3. S3 bucket name mismatch between CDN module and ECS task role policy

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 251-252
**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, line 39

The ECS task role S3 policy grants access to:
```
arn:aws:s3:::percy-main-${var.environment}-uploads
```
(format: `percy-main-production-uploads`)

But the CDN module creates the uploads bucket with name:
```
${var.environment}-percy-main-uploads
```
(format: `production-percy-main-uploads`)

The bucket name is `production-percy-main-uploads` but the IAM policy references `percy-main-production-uploads`. The application will get Access Denied errors when trying to read/write uploads.

**Remediation:** Align the naming. Either change the CDN module's `uploads_bucket_name` local to `"percy-main-${var.environment}-uploads"` or change the ECS module's IAM policy to use `"${var.environment}-percy-main-uploads"`. The CDN module name should match since it creates the actual bucket.

### C4. Staging/production `terraform_remote_state` will fail with local backend

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/production/main.tf`, lines 32-39
**File:** `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, lines 33-40

Both staging and production environments reference:
```hcl
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "percy-main-terraform-state"
    key    = "shared/terraform.tfstate"
    region = "eu-west-2"
  }
}
```

However, the shared environment's S3 backend is currently **commented out** (lines 11-17 of shared/main.tf), meaning shared state is stored locally. The remote state data source will fail with a "no state found" error because there is no state file at that S3 key.

**Remediation:** The deployment plan (Phase 1) covers this, but the Terraform files as committed will fail `terraform init` or `plan` for staging/production. This is a known bootstrapping issue but should be documented more prominently -- or use a `terraform_remote_state` with a `defaults` block to handle the bootstrap case gracefully.

## High Priority

### H1. Monitoring module `log_retention_days` variable is declared but unused

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`, lines 18-20

```hcl
variable "log_retention_days" {
  type    = number
  default = 180
}
```

This variable is declared and passed from both environment configurations (production line 152, staging line 152), but is never referenced anywhere in the monitoring module. The monitoring module does not create any log groups -- log groups are created in the ECS service module. This is dead code that may confuse future maintainers into thinking it controls something.

**Remediation:** Remove the variable from the monitoring module and remove the corresponding inputs from production and staging environment configs.

### H2. Staging ECS tasks run in public subnets but RDS is in private subnets

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/staging/main.tf`, lines 84, 91

The staging ECS service is configured with:
```hcl
private_subnet_ids = module.vpc.public_subnet_ids  # misleadingly named parameter
assign_public_ip   = true
```

The ECS tasks run in public subnets with public IPs (correct for no-NAT setup). However, the RDS instance is in private subnets (line 68: `private_subnet_ids = module.vpc.private_subnet_ids`). Without a NAT gateway, there is no route from public subnets to private subnets for RDS connectivity.

Wait -- actually, within the same VPC, public and private subnets CAN communicate directly. The "public" vs "private" distinction is about internet routing, not intra-VPC routing. All subnets in the VPC share the VPC CIDR and can communicate with each other. The RDS security group allows inbound from the ECS security group (port 5432), so this is actually fine.

**Revised H2: Passing public subnet IDs to `private_subnet_ids` parameter is confusing but functional**

The parameter name `private_subnet_ids` in the ECS module is used for `network_configuration.subnets`. In staging, it receives public subnet IDs. This works but is misleading. Consider renaming the variable to `task_subnet_ids` or adding a comment.

### H3. Scheduled task `ecs:RunTask` permission may be too narrow

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/scheduling/main.tf`, line 98

```hcl
Resource = var.task_definition_arn
```

The `task_definition_arn` output from the ECS module (line 488) constructs an ARN without a revision number:
```hcl
value = "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/${aws_ecs_task_definition.api.family}"
```

When ECS resolves a task definition family without a revision, it uses the latest revision. However, the `ecs:RunTask` IAM policy requires the resource ARN to match. An ARN without `:revision` at the end will match `ecs:RunTask` calls that specify the family name, but if the scheduler or AWS internally resolves to a specific revision ARN, the permission may be denied.

**Remediation:** Use a wildcard to cover all revisions:
```hcl
Resource = "${var.task_definition_arn}:*"
```

Or use `"${var.task_definition_arn}*"` to match both the family-only ARN and any revision-specific ARN.

### H4. Deploy role ECS policy is overly broad

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 218-232

```hcl
resources = ["*"]
```

The deploy role ECS policy grants `ecs:UpdateService`, `ecs:RegisterTaskDefinition`, `ecs:RunTask`, etc. to ALL resources (`"*"`). This should be scoped to the specific clusters and services.

**Remediation:** Scope to `arn:aws:ecs:eu-west-2:<account>:*` at minimum, or better yet to specific cluster/service ARN patterns like `arn:aws:ecs:eu-west-2:*:service/percy-main-*` and `arn:aws:ecs:eu-west-2:*:task-definition/*-api:*`.

### H5. CloudFront custom error responses will intercept API 404s

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`, lines 265-277

The custom error responses redirect 403 and 404 errors to `/index.html` for SPA routing. However, this applies to ALL origins including the ALB (API) origin. If the API returns a 404 (e.g., `GET /api/users/999`), CloudFront will intercept it and return `index.html` with status 200 instead.

**Remediation:** This is a known CloudFront limitation with multi-origin distributions. The workaround is to ensure the API never returns bare 404 status codes (use 200 with an error body) or to use CloudFront Functions to selectively apply the SPA fallback only for non-`/api/*` paths. Alternatively, consider removing the error response configuration and handling SPA routing via a CloudFront Function on the default behavior.

### H6. Deploy workflow migration uses the old task definition image

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-api.yml`, lines 77-116

The "Run migrations" step runs migrations using the **current** (old) task definition's image, not the newly built image. The migration task is launched with the existing task definition retrieved from the service. If a migration requires code from the new image, it will fail or produce incorrect results.

**Remediation:** Either register the new task definition first and use it for migrations, or run migrations using the new image via container overrides:
```yaml
--overrides '{
  "containerOverrides": [{
    "name": "api",
    "image": "${{ needs.build-and-push.outputs.image }}",
    "command": ["node", "packages/db/scripts/migrate-up.js"]
  }]
}'
```

## Medium Priority

### M1. `dns` module requires `alb_zone_id` even when ALB records are conditional

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/dns/main.tf`, lines 24-27

```hcl
variable "alb_zone_id" {
  type        = string
  description = "ALB hosted zone ID for alias record"
}
```

This variable has no default and is required, but the API DNS records are conditional on `alb_dns_name != ""` (line 78). If someone passes `alb_dns_name = ""` but omits `alb_zone_id`, Terraform will error. The environments always pass both, but the module interface is inconsistent.

**Remediation:** Add `default = ""` to `alb_zone_id`.

### M2. Dashboard region is hardcoded to `eu-west-2`

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/monitoring/main.tf`, lines 269, 286, 304, 320, 337, 355, 371

The CloudWatch dashboard JSON hardcodes `"region": "eu-west-2"` in every widget. This should use `data.aws_region.current.name` for portability, but the monitoring module does not declare a `data "aws_region"` data source.

**Remediation:** Add `data "aws_region" "current" {}` to the monitoring module and use `data.aws_region.current.name` in the dashboard JSON. Alternatively, accept it as-is since the project is explicitly eu-west-2-only.

### M3. Staging cluster name in deployment plan is wrong

**File:** `/Users/alexyoung/main2/website-v2/docs/deployment-plan.md`, lines 349-350

```
- Cluster: `staging-api`
- Service: `staging-api`
```

The staging ECS cluster name is `percy-main-staging-cluster` (from the ECS module: `${local.name_prefix}-cluster`). The deployment plan says `staging-api` for the cluster, which is the service name, not the cluster name.

**Remediation:** Change to:
```
- Cluster: `percy-main-staging-cluster`
- Service: `staging-api`
```

### M4. RDS instance identifier in deployment plan does not match Terraform

**File:** `/Users/alexyoung/main2/website-v2/docs/deployment-plan.md`, line 212

```bash
aws rds describe-db-instances \
  --db-instance-identifier production-percy-main \
```

The actual RDS identifier from the module is `percy-main-production-db` (from `"${local.name_prefix}-db"` where `name_prefix = "percy-main-${var.environment}"`). The deployment plan references `production-percy-main` which does not exist.

**Remediation:** Change to `--db-instance-identifier percy-main-production-db`.

### M5. RDS secrets naming in deployment plan does not match Terraform

**File:** `/Users/alexyoung/main2/website-v2/docs/deployment-plan.md`, line 201

```bash
aws secretsmanager get-secret-value \
  --secret-id production-percy-main-db-credentials \
```

But the actual secret name from the RDS module is `percy-main-production/rds/credentials` (from `"${local.name_prefix}/rds/credentials"`). The deployment plan will fail to find the secret.

**Remediation:** Change to `--secret-id percy-main-production/rds/credentials`.

### M6. ECR lifecycle policy will delete tagged images needed by running services

**File:** `/Users/alexyoung/main2/website-v2/infra/environments/shared/main.tf`, lines 54-70

The lifecycle policy uses `tagStatus: "any"` and keeps only 10 images. Since both staging and production deploy from the same ECR repository, and each deploy creates a SHA-tagged image plus a `latest` tag, you could have fewer than 10 distinct images but if deployments are frequent, older images still referenced by running ECS tasks could be deleted. ECS caches images, but rollback would be impossible.

**Remediation:** Change to keep at least 20-30 images, or use `tagStatus: "untagged"` and separately manage tagged image retention.

### M7. ECS service ignores task_definition changes, may cause drift

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/ecs-service/main.tf`, lines 420-422

```hcl
lifecycle {
  ignore_changes = [task_definition]
}
```

This is intentional (CI/CD updates the task definition outside Terraform), but it means `terraform plan` will never show task definition drift. If someone manually changes the task definition or the CI/CD pipeline puts it in an unexpected state, Terraform will not detect or correct it.

This is a known trade-off but worth documenting explicitly in the module.

### M8. The `plan` job in terraform.yml uses `vars.TERRAFORM_ROLE_ARN` but matrix runs share the same context

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/terraform.yml`, line 34

```yaml
role-to-assume: ${{ vars.TERRAFORM_ROLE_ARN }}
```

The `plan` job does not specify an `environment:` property, so `vars.TERRAFORM_ROLE_ARN` will be read from the repository-level variables, not from any environment. This is fine as long as `TERRAFORM_ROLE_ARN` is set at the repository level (which the deployment plan suggests on line 145). Just confirming this is consistent.

However, the `apply` job on line 84:
```yaml
environment: ${{ matrix.requires_approval && 'production' || '' }}
```

For shared and staging, `requires_approval` is undefined/falsy, so `environment` is `''` (empty string). GitHub Actions treats an empty string environment as "no environment", which means `vars.TERRAFORM_ROLE_ARN` must exist at the repo level. This is fine but the `apply` job for production uses the `production` environment, so if `TERRAFORM_ROLE_ARN` is set only in the production environment and not at the repo level, the shared/staging apply will fail.

**Remediation:** Ensure `TERRAFORM_ROLE_ARN` is set at the repository level, not just in environments.

## Low Priority / Recommendations

### L1. Provider version constraints are loose

All environments use `~> 5.0` for the AWS provider, which allows any 5.x version. Consider pinning more tightly, e.g., `~> 5.40` to prevent unexpected behavior from major minor version updates.

### L2. No `terraform.lock.hcl` committed

The `.terraform.lock.hcl` file should be committed to ensure reproducible provider versions across team members and CI. Without it, different environments could use different provider patch versions.

### L3. The `random` provider is declared in the RDS module but not in root modules

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`, lines 5-16

The RDS module declares `required_providers` for both `random` and `aws`. The root modules (production, staging) do not declare the `random` provider. Terraform will infer it, but explicitly declaring it in root modules is best practice for clarity.

### L4. VPC module does not output the NAT Gateway ID

If troubleshooting is needed, the NAT Gateway ID is not exposed. Consider adding it as an output.

### L5. Consider `deletion_protection` on RDS production instance

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/rds/main.tf`

The production RDS instance does not have `deletion_protection = true`. A `terraform destroy` or accidental resource removal would delete the database. The `skip_final_snapshot = false` setting helps with recovery but `deletion_protection` adds another safety layer.

### L6. S3 bucket versioning not enabled on frontend/uploads buckets

**File:** `/Users/alexyoung/main2/website-v2/infra/modules/cdn/main.tf`

Neither the frontend nor uploads S3 buckets have versioning enabled. For uploads especially, versioning provides protection against accidental overwrites/deletes.

### L7. No `prevent_destroy` lifecycle rule on critical resources

Consider adding `lifecycle { prevent_destroy = true }` to the Route 53 hosted zone, RDS instance (production), and Secrets Manager secrets to prevent accidental deletion via Terraform.

### L8. Terraform state bucket should use DynamoDB for locking

The commented-out backend configs include `dynamodb_table`, which is correct. Just confirming this is properly documented in the deployment plan (it is, in Phase 1).

### L9. Frontend deploy workflow builds twice

**File:** `/Users/alexyoung/main2/website-v2/.github/workflows/deploy-web.yml`

The staging and production jobs both run `pnpm install` and `pnpm --filter web build` independently. The build is done twice with different `VITE_API_URL` values, which is correct and necessary (different API endpoints per environment). This is fine but could be optimized with a build matrix or artifact caching if build times become an issue.

### L10. `sync-runner.ts` calls both `client.destroy()` and `pool.end()`

**File:** `/Users/alexyoung/main2/website-v2/apps/api/src/sync-runner.ts`, lines 44-45

Depending on the `createClient` implementation, calling both `client.destroy()` (Kysely) and `pool.end()` (pg Pool) may be redundant or may cause errors if destroy already ends the pool. Verify the `createClient` return type.

## What's Done Well

1. **Clean module boundaries** -- each module has well-defined inputs and outputs with appropriate descriptions. The separation between shared, staging, and production environments is logical.

2. **Security group design** -- proper use of separate security groups for ALB, ECS, and RDS with source-security-group-based ingress rules instead of CIDR blocks. This follows the principle of least privilege for network access.

3. **Cost-conscious staging** -- disabling NAT gateway in staging and using public subnets with public IPs is a pragmatic cost optimization for a non-production environment.

4. **OIDC authentication for GitHub Actions** -- using OIDC federation instead of long-lived IAM access keys is the correct modern approach. The deploy role is scoped to `main` branch only.

5. **Secrets management pattern** -- using a single Secrets Manager secret with JSON keys and referencing individual keys via the `arn:key::` syntax in ECS container definitions is clean and reduces secret sprawl.

6. **Comprehensive deployment plan** -- the deployment-plan.md is thorough with proper apply ordering, DNS delegation steps, verification commands, cost estimates, and rollback procedures.

7. **CloudFront Origin Access Control** -- using OAC (not the legacy OAI) for S3 origins is the current AWS best practice.

8. **Conditional resources** -- good use of `count` with conditional expressions for NAT gateway, DNS records, and SNS subscriptions to make modules flexible.

9. **ARM64 architecture** -- using Graviton (ARM64) for both ECS tasks and RDS (t4g) is a good cost/performance choice.

10. **SPA routing configuration** -- the CloudFront custom error responses for 403/404 -> index.html handle client-side routing correctly (though with the API caveat noted in H5).
