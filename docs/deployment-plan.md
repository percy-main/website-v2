# Deployment Plan — Percy Main v2

This document is the bootstrap runbook for deploying Percy Main v2 to AWS. It covers manual steps, Terraform apply order, DNS delegation, secrets population, and first deployment.

## Prerequisites

- AWS account with root access (initial setup only)
- AWS CLI v2 installed and configured (profile: `percy-main`)
- Terraform >= 1.7 installed
- GitHub repository: `percy-main/website-v2`
- Domain: `percymain.org` (registered with external registrar)
- Docker installed locally (for initial image build)

All `aws` CLI commands in this runbook use `--profile percy-main`. For Terraform, export the profile:

```bash
export AWS_PROFILE=percy-main
```

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
- GitHub Actions OIDC provider
- IAM roles:
  - `percy-main-terraform` — apply role (main branch only)
  - `percy-main-terraform-plan` — read-only plan role (PRs)
  - `percy-main-deploy` — deploy role (main branch only, scoped ECS/ECR/S3 permissions)
- SES domain identity (`contact.percymain.org`) + DKIM records
- ACM certificates:
  - ALB cert (eu-west-2): `api.v2.percymain.org`
  - CloudFront cert (us-east-1): `percymain.org` + `*.percymain.org` (wildcard covers `v2.percymain.org`)

### 2.2 Subdomain delegation at Netlify

The v1 site continues to serve `percymain.org` via Netlify DNS. Rather than moving the full zone, delegate only the subdomains AWS needs. After applying shared, get the Route 53 nameservers:

```bash
terraform output zone_name_servers
```

At **Netlify DNS** (percymain.org zone), add the following NS records:

**Delegate `v2.percymain.org`** (site + API):

| Type | Name | Value           |
| ---- | ---- | --------------- |
| NS   | v2   | `<route53-ns1>` |
| NS   | v2   | `<route53-ns2>` |
| NS   | v2   | `<route53-ns3>` |
| NS   | v2   | `<route53-ns4>` |

**Delegate `contact.percymain.org`** (SES sending domain):

| Type | Name    | Value           |
| ---- | ------- | --------------- |
| NS   | contact | `<route53-ns1>` |
| NS   | contact | `<route53-ns2>` |
| NS   | contact | `<route53-ns3>` |
| NS   | contact | `<route53-ns4>` |

Replace `<route53-ns1>` etc. with the four nameservers from the output above.

**Wait for propagation** (usually minutes, up to 48 hours). Verify:

```bash
dig NS v2.percymain.org +short
dig NS contact.percymain.org +short
```

Both should return the Route 53 nameservers.

### 2.3 Add CloudFront ACM validation record at Netlify

The CloudFront cert (`percymain.org` + `*.percymain.org`) needs a DNS validation CNAME at the root zone level, which is still at Netlify. Get the validation record:

```bash
aws --profile percy-main acm describe-certificate \
  --certificate-arn $(terraform output -raw acm_cloudfront_certificate_arn) \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

Add the output CNAME record at Netlify DNS manually. This is a one-time step.

### 2.4 Verify ACM certificates

The ALB cert (`api.v2.percymain.org`) auto-validates via Route 53 (under the delegated `v2` subdomain). The CloudFront cert validates via the CNAME you added at Netlify. Check status:

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

### 2.5 Verify SES

SES DKIM and verification records auto-validate via Route 53 (under the delegated `contact` subdomain). Check:

```bash
aws --profile percy-main ses get-identity-verification-attributes \
  --identities contact.percymain.org \
  --query 'VerificationAttributes.*.VerificationStatus'
```

If the account is in the SES sandbox, request production access:

```bash
aws --profile percy-main sesv2 put-account-details \
  --mail-type TRANSACTIONAL \
  --website-url "https://percymain.org" \
  --contact-language EN \
  --use-case-description "Transactional emails for sports club membership management"
```

### 2.6 Configure GitHub repository

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
aws --profile percy-main secretsmanager put-secret-value \
  --secret-id production/percy-main/app \
  --secret-string '{
    "DATABASE_URL": "postgres://percy:<RDS_PASSWORD>@<RDS_ENDPOINT>/percy_main",
    "BETTER_AUTH_SECRET": "<generate: openssl rand -hex 32>",
    "BETTER_AUTH_RP_ID": "v2.percymain.org",
    "BETTER_AUTH_RP_NAME": "Percy Main CSC",
    "BASE_URL": "https://v2.percymain.org",
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

## Phase 4: First Deployment

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
curl -I https://v2.percymain.org
```

### 4.6 Configure Stripe webhook

Create a webhook in Stripe dashboard pointing to `https://api.v2.percymain.org/api/stripe/webhook` and update the `STRIPE_WEBHOOK_SECRET` in Secrets Manager.

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

## Apply Order Summary

1. Manual: Create S3 state bucket + DynamoDB lock table
2. Manual: Uncomment S3 backend blocks (shared + production)
3. `terraform apply` — shared
4. Manual: Subdomain delegation at Netlify (`v2` + `contact` NS records → Route 53)
5. Manual: Add CloudFront ACM validation CNAME at Netlify
6. Wait: ACM certificate validation + SES verification
7. `terraform apply` — production
8. Manual: Populate production secrets
9. Manual: Configure GitHub environment variables (`DEPLOY_ROLE_ARN`, `TERRAFORM_ROLE_ARN`, `TERRAFORM_PLAN_ROLE_ARN`, `FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`)
10. Manual: Push initial Docker image + run migrations
11. Manual: Configure Stripe webhooks
12. Verify: Health checks, frontend, monitoring

When ready to migrate to the root domain: move full NS delegation to Route 53, change `domain_name` from `v2.percymain.org` to `percymain.org`, and apply.
