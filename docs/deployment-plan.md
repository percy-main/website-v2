# Deployment Plan — Percy Main v2

This document is the bootstrap runbook for deploying Percy Main v2 to AWS. It covers manual steps, Terraform apply order, DNS delegation, secrets population, and first deployment.

## Prerequisites

- AWS account with root access (initial setup only)
- AWS CLI v2 installed and configured
- Terraform >= 1.7 installed
- GitHub repository: `percy-main/website-v2`
- Domain: `percymain.org` (registered with external registrar)
- Docker installed locally (for initial image build)

## Phase 1: AWS Account Bootstrap

These steps must be done manually before any Terraform runs.

### 1.1 Create IAM admin user

1. Sign in to AWS Console as root
2. Enable MFA on root account
3. Create IAM user with `AdministratorAccess` for day-to-day use
4. Configure AWS CLI: `aws configure --profile percy-main`

### 1.2 Create Terraform state backend

```bash
# S3 bucket for state
aws s3api create-bucket \
  --bucket percy-main-terraform-state \
  --region eu-west-2 \
  --create-bucket-configuration LocationConstraint=eu-west-2

aws s3api put-bucket-versioning \
  --bucket percy-main-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket percy-main-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
  }'

aws s3api put-public-access-block \
  --bucket percy-main-terraform-state \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# DynamoDB table for state locking
aws dynamodb create-table \
  --table-name percy-main-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region eu-west-2
```

### 1.3 Uncomment S3 backends

After creating the state bucket, uncomment the `backend "s3"` blocks in:

- `infra/environments/shared/main.tf`
- `infra/environments/production/main.tf`
- `infra/environments/staging/main.tf`

**Important:** The CI pipeline includes a guard that will fail if backends are still commented out.

## Phase 2: Shared Infrastructure

### 2.1 Apply shared environment

```bash
cd infra/environments/shared
terraform init
terraform plan
terraform apply
```

This creates:
- Route 53 hosted zone
- ECR repository (immutable tags, scan on push, 25-image retention)
- SES domain identity + DKIM records
- GitHub Actions OIDC provider
- IAM roles:
  - `percy-main-terraform` — apply role (main branch only)
  - `percy-main-terraform-plan` — read-only plan role (PRs)
  - `percy-main-deploy` — deploy role (main branch only, scoped ECS/ECR/S3 permissions)
- ACM certificates:
  - ALB cert (eu-west-2): `api.percymain.org` + `api.staging.percymain.org`
  - CloudFront cert (us-east-1): `percymain.org` + `*.percymain.org`

### 2.2 DNS delegation

After applying shared, Terraform outputs `zone_name_servers`. Update your domain registrar's NS records:

```bash
terraform output zone_name_servers
```

At your registrar (e.g. Namecheap, GoDaddy), set the nameservers for `percymain.org` to the four values output above.

**Wait for propagation** — this can take up to 48 hours. Verify:

```bash
dig NS percymain.org +short
```

### 2.3 Verify ACM certificates

ACM certificates use DNS validation via Route 53. They will auto-validate once NS delegation propagates. Check status:

```bash
aws acm describe-certificate \
  --certificate-arn $(terraform output -raw acm_alb_certificate_arn) \
  --query 'Certificate.Status'

aws acm describe-certificate \
  --certificate-arn $(terraform output -raw acm_cloudfront_certificate_arn) \
  --region us-east-1 \
  --query 'Certificate.Status'
```

Both should show `ISSUED`. Do not proceed to Phase 3 until certificates are issued.

### 2.4 Verify SES

SES domain identity verification also happens via DNS. Check:

```bash
aws ses get-identity-verification-attributes \
  --identities notifications.percymain.org \
  --query 'VerificationAttributes.*.VerificationStatus'
```

If the account is in the SES sandbox, request production access:

```bash
aws sesv2 put-account-details \
  --mail-type TRANSACTIONAL \
  --website-url "https://percymain.org" \
  --contact-language EN \
  --use-case-description "Transactional emails for sports club membership management"
```

### 2.5 Configure GitHub repository

Add the following GitHub Actions variables (Settings → Environments → each environment):

| Variable | Value | Environments |
|----------|-------|-------------|
| `DEPLOY_ROLE_ARN` | `terraform output -raw deploy_role_arn` | staging, production |
| `TERRAFORM_ROLE_ARN` | `terraform output -raw terraform_role_arn` | (repo-level) |
| `TERRAFORM_PLAN_ROLE_ARN` | `terraform output -raw terraform_plan_role_arn` | (repo-level) |
| `FRONTEND_BUCKET` | Set after production/staging apply | staging, production |
| `CLOUDFRONT_DISTRIBUTION_ID` | Set after production/staging apply | staging, production |

Create GitHub environments:
- `staging` — no protection rules
- `production` — require reviewers (add yourself)

## Phase 3: Production Infrastructure

### 3.1 Apply production environment

```bash
cd infra/environments/production
terraform init
terraform apply
```

This creates:
- VPC (10.0.0.0/16) with public and private subnets (no NAT Gateway), VPC Flow Logs
- RDS PostgreSQL 16 (db.t4g.micro, single-AZ, deletion protection, Performance Insights, 14-day backups)
- ECS Fargate cluster + service + ALB:
  - 1 task (auto-scales to 4 via CPU target tracking at 70%)
  - Tasks run in public subnets with public IPs (no NAT Gateway needed)
  - Deployment circuit breaker with automatic rollback
  - 30-second ALB deregistration delay
  - ALB access logs to S3
- CloudFront distribution + S3 buckets (SSE-S3 encryption, uploads versioning enabled)
  - CloudFront access logging to S3
  - CloudFront Function for SPA routing (frontend paths only)
  - HTTPS-only origin protocol to ALB
- Route 53 DNS records
- CloudWatch monitoring: CPU, memory, 5xx errors, unhealthy hosts, p99 latency, RDS CPU/storage/connections
- SNS alarm topic (KMS encrypted)
- EventBridge scheduler for Play Cricket sync

### 3.2 Populate secrets

Terraform creates an empty Secrets Manager secret. Populate it with application secrets:

```bash
aws secretsmanager put-secret-value \
  --secret-id production/percy-main/app \
  --secret-string '{
    "DATABASE_URL": "postgres://percy:<RDS_PASSWORD>@<RDS_ENDPOINT>/percy_main",
    "BETTER_AUTH_SECRET": "<generate: openssl rand -hex 32>",
    "BETTER_AUTH_RP_ID": "percymain.org",
    "BETTER_AUTH_RP_NAME": "Percy Main CSC",
    "BASE_URL": "https://percymain.org",
    "STRIPE_SECRET_KEY": "<from Stripe dashboard>",
    "STRIPE_WEBHOOK_SECRET": "<from Stripe webhook setup>",
    "GOOGLE_CLIENT_ID": "<from Google Cloud Console>",
    "GOOGLE_CLIENT_SECRET": "<from Google Cloud Console>",
    "PLAY_CRICKET_API_TOKEN": "<from Play Cricket>",
    "PLAY_CRICKET_SITE_ID": "<from Play Cricket>",
    "SLACK_WEBHOOK_URL": "<from Slack app>",
    "SES_FROM_ADDRESS": "Percy Main CSC Support <support@notifications.percymain.org>"
  }'
```

To get the RDS password (auto-generated by Terraform):

```bash
aws secretsmanager get-secret-value \
  --secret-id percy-main-production/rds/credentials \
  --query 'SecretString' --output text | jq -r '.password'
```

To get the RDS endpoint:

```bash
aws rds describe-db-instances \
  --db-instance-identifier percy-main-production-db \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

### 3.3 Update GitHub environment variables

```bash
cd infra/environments/production
echo "FRONTEND_BUCKET: $(terraform output -raw frontend_bucket_name)"
echo "CLOUDFRONT_DISTRIBUTION_ID: $(terraform output -raw cloudfront_distribution_id)"
```

Add these to the `production` GitHub environment.

## Phase 4: Staging Infrastructure

### 4.1 Apply staging environment

```bash
cd infra/environments/staging
terraform init
terraform apply
```

Staging uses the same architecture as production with smaller values:
- VPC CIDR: 10.1.0.0/16
- No NAT Gateway (same as production — tasks use public IPs)
- 1 ECS task (auto-scales to 2)
- 30-day log retention

### 4.2 Populate staging secrets

Same pattern as production but with staging-specific values:

```bash
aws secretsmanager put-secret-value \
  --secret-id staging/percy-main/app \
  --secret-string '{
    "DATABASE_URL": "postgres://percy:<STAGING_RDS_PASSWORD>@<STAGING_RDS_ENDPOINT>/percy_main",
    "BETTER_AUTH_SECRET": "<generate: openssl rand -hex 32>",
    "BETTER_AUTH_RP_ID": "staging.percymain.org",
    "BETTER_AUTH_RP_NAME": "Percy Main CSC (Staging)",
    "BASE_URL": "https://staging.percymain.org",
    "STRIPE_SECRET_KEY": "<Stripe TEST key>",
    "STRIPE_WEBHOOK_SECRET": "<Stripe TEST webhook>",
    "GOOGLE_CLIENT_ID": "<same or test>",
    "GOOGLE_CLIENT_SECRET": "<same or test>",
    "PLAY_CRICKET_API_TOKEN": "<from Play Cricket>",
    "PLAY_CRICKET_SITE_ID": "<from Play Cricket>",
    "SLACK_WEBHOOK_URL": "<staging channel or omit>",
    "SES_FROM_ADDRESS": "Percy Main CSC Support <support@notifications.percymain.org>"
  }'
```

To get the staging RDS credentials:

```bash
aws secretsmanager get-secret-value \
  --secret-id percy-main-staging/rds/credentials \
  --query 'SecretString' --output text | jq -r '.password'

aws rds describe-db-instances \
  --db-instance-identifier percy-main-staging-db \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

### 4.3 Update GitHub staging variables

```bash
cd infra/environments/staging
echo "FRONTEND_BUCKET: $(terraform output -raw frontend_bucket_name)"
echo "CLOUDFRONT_DISTRIBUTION_ID: $(terraform output -raw cloudfront_distribution_id)"
```

## Phase 5: First Deployment

### 5.1 Build and push initial Docker image

The first deployment needs a manually pushed image since CI hasn't run yet:

```bash
# Login to ECR
aws ecr get-login-password --region eu-west-2 | \
  docker login --username AWS --password-stdin \
  $(terraform -chdir=infra/environments/shared output -raw ecr_repository_url | cut -d/ -f1)

# Build ARM64 image (tag with a unique identifier — ECR uses immutable tags)
docker buildx build \
  --platform linux/arm64 \
  --push \
  -t $(terraform -chdir=infra/environments/shared output -raw ecr_repository_url):initial \
  -f apps/api/Dockerfile \
  .
```

### 5.2 Run initial migrations

```bash
# Run migrations as one-off ECS task
aws ecs run-task \
  --cluster percy-main-production-cluster \
  --task-definition production-api \
  --launch-type FARGATE \
  --network-configuration "$(aws ecs describe-services \
    --cluster percy-main-production-cluster \
    --services production-api \
    --query 'services[0].networkConfiguration' \
    --output json)" \
  --overrides '{
    "containerOverrides": [{
      "name": "api",
      "command": ["node", "apps/api/dist/migrate.js"]
    }]
  }'
```

### 5.3 Force ECS service redeployment

After secrets are populated and migrations have run:

```bash
aws ecs update-service \
  --cluster percy-main-production-cluster \
  --service production-api \
  --force-new-deployment
```

### 5.4 Verify

```bash
# Check ECS tasks are running
aws ecs describe-services \
  --cluster percy-main-production-cluster \
  --services production-api \
  --query 'services[0].{desired: desiredCount, running: runningCount, status: status}'

# Check health endpoint
curl https://api.percymain.org/health

# Check frontend
curl -I https://percymain.org
```

### 5.5 Configure Stripe webhook

Create a webhook in Stripe dashboard pointing to `https://api.percymain.org/api/stripe/webhook` and update the `STRIPE_WEBHOOK_SECRET` in Secrets Manager.

## Phase 6: Repeat for staging

Repeat steps 5.1–5.4 for the staging environment, substituting:
- Cluster: `percy-main-staging-cluster`
- Service: `staging-api`
- Endpoint: `https://api.staging.percymain.org/health`

## Ongoing Operations

### Deploying code changes

After initial setup, all deployments are automated:
- **API changes** → push to main triggers `.github/workflows/deploy-api.yml`
  - Builds Docker image (ARM64), tags with commit SHA (immutable tags)
  - Registers new task definition, runs migrations with new image, updates service
  - Deploys to staging first (with smoke test), then production (requires environment approval + smoke test)
  - ECS deployment circuit breaker auto-rolls back failed deployments
- **Frontend changes** → push to main triggers `.github/workflows/deploy-web.yml`
- **Infrastructure changes** → PR shows plan (read-only role), merge to main applies (chained: shared → staging → production)

### Running migrations

Migrations run automatically as part of the API deploy pipeline. For manual runs:

```bash
aws ecs run-task \
  --cluster percy-main-production-cluster \
  --task-definition production-api \
  --launch-type FARGATE \
  --network-configuration "$(aws ecs describe-services \
    --cluster percy-main-production-cluster \
    --services production-api \
    --query 'services[0].networkConfiguration' --output json)" \
  --overrides '{
    "containerOverrides": [{
      "name": "api",
      "command": ["node", "apps/api/dist/migrate.js"]
    }]
  }'
```

### Play Cricket sync

Runs automatically via EventBridge Scheduler (Sun/Fri at 3am UK time). To trigger manually:

```bash
aws ecs run-task \
  --cluster percy-main-production-cluster \
  --task-definition production-api \
  --launch-type FARGATE \
  --network-configuration "$(aws ecs describe-services \
    --cluster percy-main-production-cluster \
    --services production-api \
    --query 'services[0].networkConfiguration' --output json)" \
  --overrides '{
    "containerOverrides": [{
      "name": "api",
      "command": ["node", "apps/api/dist/sync-runner.js"]
    }]
  }'
```

### Monitoring

- **CloudWatch Dashboard**: `percy-main-production-dashboard` in eu-west-2
- **Alarms** (SNS, KMS encrypted):
  - ECS: CPU > 80%, memory > 80%
  - ALB: 5xx errors > 10, unhealthy hosts > 0, p99 latency > 2s
  - RDS: CPU > 80%, free storage < 2 GB, connections > 60
- **Logs**: CloudWatch Log Group `/ecs/production-api` (30-day retention)
- **VPC Flow Logs**: `/vpc/percy-main-production-flow-logs`
- **ALB Access Logs**: S3 bucket `percy-main-production-alb-logs`
- **CloudFront Logs**: S3 bucket `percy-main-production-cdn-logs`

### Auto-scaling

ECS auto-scaling is configured with CPU target tracking:
- **Production**: min 1, max 4 tasks (scales out at 70% CPU, 60s cooldown; scales in at 300s cooldown)
- **Staging**: min 1, max 2 tasks

Auto-scaling is independent of Terraform (`desired_count` is in `ignore_changes`).

### Rollback

To roll back to a previous API version:

```bash
# List recent task definitions
aws ecs list-task-definitions \
  --family-prefix production-api \
  --sort DESC --max-items 5

# Update service to previous revision
aws ecs update-service \
  --cluster percy-main-production-cluster \
  --service production-api \
  --task-definition production-api:<PREVIOUS_REVISION> \
  --force-new-deployment
```

Note: The ECS deployment circuit breaker will automatically roll back failed deployments without manual intervention.

## Cost Estimate (Monthly)

| Resource | Production | Staging |
|----------|-----------|---------|
| ECS Fargate (ARM64, 1 task base) | ~$8 | ~$8 |
| RDS db.t4g.micro | ~$13 | ~$13 |
| ALB | ~$18 | ~$18 |
| CloudFront | ~$1 | ~$1 |
| Route 53 | ~$1 | — |
| S3 (assets + logs) | ~$1 | ~$1 |
| Secrets Manager | ~$1 | ~$1 |
| CloudWatch (logs + alarms) | ~$2 | ~$1 |
| **Total** | **~$45** | **~$43** |

**Grand total: ~$88/month**

Key cost decisions:
- No NAT Gateway in either environment (tasks use public IPs, RDS stays in private subnets)
- Container Insights disabled (standard ECS metrics suffice)
- 30-day log retention (both environments)
- 1 base task in production (auto-scales to 4 on demand)
- ARM64/Graviton for ECS + RDS
- PriceClass_100 for CloudFront (EU + NA only)

## Apply Order Summary

1. Manual: Create S3 state bucket + DynamoDB lock table
2. Manual: Uncomment S3 backend blocks
3. `terraform apply` — shared
4. Manual: DNS delegation at registrar
5. Wait: ACM certificate validation + SES verification
6. `terraform apply` — production
7. Manual: Populate production secrets
8. Manual: Push initial Docker image + run migrations
9. `terraform apply` — staging
10. Manual: Populate staging secrets
11. Manual: Configure GitHub environment variables (`DEPLOY_ROLE_ARN`, `TERRAFORM_ROLE_ARN`, `TERRAFORM_PLAN_ROLE_ARN`, `FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`)
12. Manual: Configure Stripe webhooks
13. Verify: Health checks, frontend, monitoring
