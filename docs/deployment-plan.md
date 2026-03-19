# Deployment Plan — Percy Main v2

This document is the bootstrap runbook for deploying Percy Main v2 to AWS. It covers manual steps, Terraform apply order, DNS delegation, secrets population, and first deployment.

## Prerequisites

- AWS account with root access (initial setup only)
- AWS CLI v2 installed and configured (profile: `percy-main`)
- Terraform >= 1.7 installed
- GitHub repository: `percy-main/website-v2`
- Domain: `percymain.org` (registered with GoDaddy, NS delegated to Route 53)
- Docker installed locally (for initial image build)

All `aws` CLI commands in this runbook use `--profile percy-main`. For Terraform, export the profile:

```bash
export AWS_PROFILE=percy-main
```

## Phase 1: AWS Account Bootstrap [DONE]

These steps must be done manually before any Terraform runs.

### 1.1 Create IAM admin user

1. Sign in to AWS Console as root
2. Enable MFA on root account
3. Create IAM user with `AdministratorAccess` for day-to-day use
4. Configure AWS CLI: `aws configure --profile percy-main`

### 1.2 Create Terraform state backend

```bash
# S3 bucket for state
aws --profile percy-main s3api create-bucket \
  --bucket percy-main-terraform-state-bucket \
  --region eu-west-2 \
  --create-bucket-configuration LocationConstraint=eu-west-2

aws --profile percy-main s3api put-bucket-versioning \
  --bucket percy-main-terraform-state-bucket \
  --versioning-configuration Status=Enabled

aws --profile percy-main s3api put-bucket-encryption \
  --bucket percy-main-terraform-state-bucket \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
  }'

aws --profile percy-main s3api put-public-access-block \
  --bucket percy-main-terraform-state-bucket \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# DynamoDB table for state locking
aws --profile percy-main dynamodb create-table \
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

**Important:** The CI pipeline includes a guard that will fail if backends are still commented out.

## Phase 2: Shared Infrastructure [DONE]

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
- GitHub Actions OIDC provider
- IAM roles:
  - `percy-main-terraform` — apply role (main branch only)
  - `percy-main-terraform-plan` — read-only plan role (PRs)
  - `percy-main-deploy` — deploy role (main branch only, scoped ECS/ECR/S3 permissions)
- SES domain identity (`contact.percymain.org`) + DKIM records
- ACM certificates:
  - ALB cert (eu-west-2): `api.v2.percymain.org`
  - CloudFront cert (us-east-1): `percymain.org` + `*.percymain.org`

### 2.2 DNS setup

DNS is managed via Route 53. Nameservers are delegated from GoDaddy:

```
ns-1598.awsdns-07.co.uk
ns-599.awsdns-10.net
ns-433.awsdns-54.com
ns-1121.awsdns-12.org
```

Route 53 hosts all DNS records including MX (Google Workspace), SPF, DKIM, DMARC, and application records.

### 2.3 Verify ACM certificates

```bash
aws --profile percy-main acm describe-certificate \
  --certificate-arn $(terraform output -raw acm_alb_certificate_arn) \
  --query 'Certificate.Status'

aws --profile percy-main acm describe-certificate \
  --certificate-arn $(terraform output -raw acm_cloudfront_certificate_arn) \
  --region us-east-1 \
  --query 'Certificate.Status'
```

Both should show `ISSUED`. Do not proceed to Phase 3 until certificates are issued.

### 2.4 Verify SES

```bash
aws --profile percy-main ses get-identity-verification-attributes \
  --identities contact.percymain.org \
  --query 'VerificationAttributes.*.VerificationStatus'
```

### 2.5 Configure GitHub repository

Add the following GitHub Actions variables (Settings → Environments → each environment):

| Variable                     | Value                                           | Environments |
| ---------------------------- | ----------------------------------------------- | ------------ |
| `DEPLOY_ROLE_ARN`            | `terraform output -raw deploy_role_arn`         | production   |
| `TERRAFORM_ROLE_ARN`         | `terraform output -raw terraform_role_arn`      | (repo-level) |
| `TERRAFORM_PLAN_ROLE_ARN`    | `terraform output -raw terraform_plan_role_arn` | (repo-level) |
| `FRONTEND_BUCKET`            | Set after production apply                      | production   |
| `CLOUDFRONT_DISTRIBUTION_ID` | Set after production apply                      | production   |

Create GitHub environments:

- `production` — require reviewers (add yourself)

## Phase 3: Production Infrastructure [DONE]

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
  - CloudFront Function for SPA routing + domain redirects
  - HTTPS-only origin protocol to ALB
- Route 53 DNS records (`api.v2.percymain.org` → ALB)
- CloudWatch monitoring: CPU, memory, 5xx errors, unhealthy hosts, p99 latency, RDS CPU/storage/connections
- SNS alarm topic (KMS encrypted)
- EventBridge scheduler for Play Cricket sync

### 3.2 Populate secrets

Terraform creates an empty Secrets Manager secret. Populate it with application secrets:

```bash
aws --profile percy-main secretsmanager put-secret-value \
  --secret-id production/percy-main/app \
  --secret-string '{
    "DATABASE_URL": "postgres://percy:<RDS_PASSWORD>@<RDS_ENDPOINT>/percy_main",
    "BETTER_AUTH_SECRET": "<must match v1 secret for migrated 2FA/passkeys>",
    "BETTER_AUTH_RP_ID": "percymain.org",
    "BETTER_AUTH_RP_NAME": "Percy Main CSC",
    "BASE_URL": "https://www.percymain.org",
    "STRIPE_SECRET_KEY": "<from Stripe dashboard>",
    "STRIPE_WEBHOOK_SECRET": "<from Stripe webhook setup>",
    "GOOGLE_CLIENT_ID": "<from Google Cloud Console>",
    "GOOGLE_CLIENT_SECRET": "<from Google Cloud Console>",
    "PLAY_CRICKET_API_TOKEN": "<from Play Cricket>",
    "PLAY_CRICKET_SITE_ID": "<from Play Cricket>",
    "SLACK_WEBHOOK_URL": "<from Slack app>",
    "SES_FROM_ADDRESS": "Percy Main CSC Support <support@contact.percymain.org>"
  }'
```

To get the RDS password (auto-generated by Terraform):

```bash
aws --profile percy-main secretsmanager get-secret-value \
  --secret-id percy-main-production/rds/credentials \
  --query 'SecretString' --output text | jq -r '.password'
```

To get the RDS endpoint:

```bash
aws --profile percy-main rds describe-db-instances \
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

## Phase 4: First Deployment [DONE]

### 4.1 Build and push initial Docker image

The first deployment needs a manually pushed image since CI hasn't run yet:

```bash
# Login to ECR
aws --profile percy-main ecr get-login-password --region eu-west-2 | \
  docker login --username AWS --password-stdin \
  $(AWS_PROFILE=percy-main terraform -chdir=infra/environments/shared output -raw ecr_repository_url | cut -d/ -f1)

# Choose a unique tag (ECR uses immutable tags — each tag can only be used once)
IMAGE_TAG="initial"

# Build ARM64 image and push
ECR_URL=$(AWS_PROFILE=percy-main terraform -chdir=infra/environments/shared output -raw ecr_repository_url)
docker buildx build \
  --platform linux/arm64 \
  --push \
  -t $ECR_URL:$IMAGE_TAG \
  -f apps/api/Dockerfile \
  .
```

### 4.2 Register task definition with initial image

Terraform creates the task definition with a placeholder image. Update it to use the image you just pushed:

```bash
IMAGE="$ECR_URL:$IMAGE_TAG"

TASK_DEF_ARN=$(aws --profile percy-main ecs describe-task-definition \
  --task-definition production-api \
  --query 'taskDefinition' --output json | \
  jq --arg IMAGE "$IMAGE" \
    '.containerDefinitions[0].image = $IMAGE |
     del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' | \
  aws --profile percy-main ecs register-task-definition \
    --cli-input-json file:///dev/stdin \
    --query 'taskDefinition.taskDefinitionArn' --output text)

echo "Registered: $TASK_DEF_ARN"
```

### 4.3 Run initial migrations

```bash
aws --profile percy-main ecs run-task \
  --cluster percy-main-production-cluster \
  --task-definition "$TASK_DEF_ARN" \
  --launch-type FARGATE \
  --network-configuration "$(aws --profile percy-main ecs describe-services \
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

### 4.4 Deploy to ECS

Update the service to use the new task definition:

```bash
aws --profile percy-main ecs update-service \
  --cluster percy-main-production-cluster \
  --service production-api \
  --task-definition "$TASK_DEF_ARN" \
  --force-new-deployment
```

### 4.5 Verify

```bash
# Check ECS tasks are running
aws --profile percy-main ecs describe-services \
  --cluster percy-main-production-cluster \
  --services production-api \
  --query 'services[0].{desired: desiredCount, running: runningCount, status: status}'

# Check health endpoint
curl https://api.v2.percymain.org/health

# Check frontend
curl -I https://www.percymain.org
```

### 4.6 Configure Stripe webhook

Create a webhook in Stripe dashboard pointing to `https://api.v2.percymain.org/api/stripe/webhook` and update the `STRIPE_WEBHOOK_SECRET` in Secrets Manager.

## Phase 5: Data Migration [DONE]

### 5.1 Turso → RDS data lift

Data was migrated from v1 Turso (SQLite) to v2 RDS (PostgreSQL) using the bastion tunnel script:

```bash
./scripts/bastion-tunnel.sh --source libsql://<turso-url> --token <token>
```

The script automates the full lifecycle: creates a temporary EC2 bastion, SSH tunnels to RDS, runs `pnpm run db:lift`, then tears down all resources on exit.

21,454 rows were synced across 27 tables.

### 5.2 Auth secrets alignment

- `BETTER_AUTH_SECRET` must match the v1 value (TOTP secrets are encrypted with it)
- `BETTER_AUTH_RP_ID` set to `percymain.org` (matches v1, allows passkey migration)

## Phase 6: Domain Cutover [DONE]

### 6.1 Domain configuration

- **Canonical domain**: `www.percymain.org`
- **API**: `api.v2.percymain.org` (unchanged from initial deployment)
- **DNS**: Route 53 (nameservers delegated from GoDaddy)
- **CloudFront aliases**: `percymain.org`, `www.percymain.org`, `kit.percymain.org`

### 6.2 CloudFront Function redirects

- `percymain.org/*` → 301 → `www.percymain.org/*`
- `kit.percymain.org` → 301 → `https://vx-3.com/collections/percy-main-cricket-club`

### 6.3 DNS records in Route 53

| Type | Name | Target |
| ---- | ---- | ------ |
| A (alias) | `percymain.org` | CloudFront |
| AAAA (alias) | `percymain.org` | CloudFront |
| CNAME | `www.percymain.org` | CloudFront |
| A (alias) | `api.v2.percymain.org` | ALB |
| AAAA (alias) | `api.v2.percymain.org` | ALB |
| A (alias) | `kit.percymain.org` | CloudFront |
| AAAA (alias) | `kit.percymain.org` | CloudFront |
| MX | `percymain.org` | Google Workspace |
| MX | `cricket.percymain.org` | Google Workspace |
| TXT | `percymain.org` | SPF, Stripe verification, Google verification |
| TXT | `_dmarc.percymain.org` | DMARC policy |
| TXT | `google._domainkey.percymain.org` | DKIM |
| + SES DKIM/verification records for `contact.percymain.org` |

## Ongoing Operations

### Deploying code changes

After initial setup, all deployments are automated:

- **API changes** → push to main triggers `.github/workflows/deploy-api.yml`
  - Builds Docker image (ARM64), tags with commit SHA (immutable tags)
  - Registers new task definition, runs migrations with new image, updates service
  - Deploys directly to production (requires environment approval + smoke test)
  - ECS deployment circuit breaker auto-rolls back failed deployments
- **Frontend changes** → push to main triggers `.github/workflows/deploy-web.yml`
- **Infrastructure changes** → PR shows plan (read-only role), merge to main applies (chained: shared → production)

### Running migrations

Migrations run automatically as part of the API deploy pipeline. For manual runs:

```bash
aws --profile percy-main ecs run-task \
  --cluster percy-main-production-cluster \
  --task-definition production-api \
  --launch-type FARGATE \
  --network-configuration "$(aws --profile percy-main ecs describe-services \
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
aws --profile percy-main ecs run-task \
  --cluster percy-main-production-cluster \
  --task-definition production-api \
  --launch-type FARGATE \
  --network-configuration "$(aws --profile percy-main ecs describe-services \
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

### Data sync (Turso → RDS)

To re-sync data from v1 Turso to v2 RDS:

```bash
./scripts/bastion-tunnel.sh --source libsql://<turso-url> --token <token>
```

Requires a fresh Turso read-only token. The script handles bastion lifecycle automatically.

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

- min 1, max 4 tasks (scales out at 70% CPU, 60s cooldown; scales in at 300s cooldown)

Auto-scaling is independent of Terraform (`desired_count` is in `ignore_changes`).

### Rollback

To roll back to a previous API version:

```bash
# List recent task definitions
aws --profile percy-main ecs list-task-definitions \
  --family-prefix production-api \
  --sort DESC --max-items 5

# Update service to previous revision
aws --profile percy-main ecs update-service \
  --cluster percy-main-production-cluster \
  --service production-api \
  --task-definition production-api:<PREVIOUS_REVISION> \
  --force-new-deployment
```

Note: The ECS deployment circuit breaker will automatically roll back failed deployments without manual intervention.

## Cost Estimate (Monthly)

| Resource                         | Monthly Cost   |
| -------------------------------- | -------------- |
| ALB                              | ~$18           |
| RDS db.t4g.micro                 | ~$13           |
| ECS Fargate (ARM64, 1 task base) | ~$8            |
| CloudWatch (logs + alarms)       | ~$2            |
| S3 (assets + logs)               | ~$1            |
| Secrets Manager                  | ~$1            |
| CloudFront                       | ~$1            |
| Route 53                         | ~$1            |
| **Total**                        | **~$45/month** |

Key cost decisions:

- No staging environment (local Docker Compose + CI tests provide pre-production coverage)
- No NAT Gateway (tasks use public IPs, RDS stays in private subnets)
- Container Insights disabled (standard ECS metrics suffice)
- 30-day log retention
- 1 base task (auto-scales to 4 on demand)
- ARM64/Graviton for ECS + RDS
- PriceClass_100 for CloudFront (EU + NA only)

Note: The staging Terraform configuration is retained in `infra/environments/staging/` and can be applied on demand if a dedicated staging environment is needed temporarily.
