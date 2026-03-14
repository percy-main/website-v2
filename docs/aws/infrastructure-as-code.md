# Infrastructure as Code

All AWS infrastructure is defined and managed using Terraform. This provides version-controlled, reviewable, repeatable infrastructure that grows incrementally alongside each migration phase.

---

## Why Terraform

- **Multi-account native** — production and staging map cleanly to separate provider configurations
- **Comprehensive AWS coverage** — every service in the migration plan is well-supported by the AWS provider
- **Explicit state** — easier to reason about for a small team than CDK's abstraction layers
- **Provider ecosystem** — if we later add Cloudflare, Stripe, or other providers, it's the same tool
- **OpenTofu compatibility** — open-source fork exists as insurance against licensing changes

---

## Module Design

Production and staging are ~95% identical, differing only in sizing. Reusable modules accept variables for the differences:

```
modules/
├── vpc/           # VPC, subnets, NAT Gateway, security groups
├── ecs-service/   # Task definition, service, ALB target group, log group
├── rds/           # RDS instance, subnet group, parameter group
├── cdn/           # CloudFront distribution, S3 origin, OAC
├── monitoring/    # CloudWatch dashboards, alarms, log groups
├── dns/           # Route 53 records (hosted zone in management account)
└── ecr/           # ECR repository + cross-account pull policies
```

Each module is parameterised:

| Module        | Key Variables                                            |
| ------------- | -------------------------------------------------------- |
| `vpc`         | CIDR range, number of AZs, enable NAT Gateway            |
| `ecs-service` | Task count, CPU/memory, image tag, environment variables |
| `rds`         | Instance class, storage size, multi-AZ                   |
| `cdn`         | Domain name, ACM certificate ARN, WAF ACL                |
| `monitoring`  | Alarm thresholds, log retention days                     |

Staging calls the same modules with smaller values. No duplication.

---

## Environment Structure

```
environments/
├── management/    # Management account: ECR, Route 53 zone, Terraform state, OIDC, CloudTrail
├── production/    # Production account: calls modules with production values
└── staging/       # Staging account: calls modules with staging values (fewer tasks, smaller instances)
```

Each environment is an independent Terraform root module with its own state, deployed to its own AWS account. This keeps the blast radius small — a bad staging apply cannot touch production state, and neither workload account can affect the shared container registry or deployment infrastructure in the management account.

---

## State Management

- **S3 backend with DynamoDB locking** — standard, cheap, reliable
- **One state file per environment** — `management`, `production`, and `staging` each maintain separate state
- State bucket and lock table live in the management account — neutral ground, not owned by any workload account
- State bucket and lock table are created once during account bootstrap (see below)

---

## Terraform vs Application Boundary

Terraform builds the stage; CI/CD performs on it.

### Terraform manages (infrastructure)

- VPC, subnets, NAT Gateway, security groups
- ECS cluster, task definitions, services
- ALB, target groups, listeners
- RDS instances, parameter groups, subnet groups
- S3 buckets, CloudFront distributions
- Route 53 records, ACM certificates
- WAF rules
- CloudWatch alarms, dashboards, log groups
- ECR repositories
- SES domain verification
- EventBridge rules and targets
- IAM roles and policies
- SSM parameters and Secrets Manager secrets (structure only, not values)

### CI/CD manages (application)

- Docker image builds and pushes to ECR
- ECS service deployments (image tag updates)
- Frontend builds and S3 sync
- CloudFront cache invalidations
- Database migrations
- Secret values (set via CI or manually; Terraform creates the empty secret)

ECS task definition image tags are updated by the deploy pipeline and ignored in Terraform via `lifecycle { ignore_changes }` rules. This prevents Terraform from reverting a deployment.

---

## CI/CD for Infrastructure

```
PR opened/updated  →  terraform plan  →  plan output posted as PR comment
PR merged to main  →  terraform apply (auto for staging, manual approval gate for production)
```

GitHub Actions with OIDC for AWS authentication — no long-lived credentials stored anywhere.

Path filters ensure only infrastructure changes trigger Terraform pipelines.

---

## Account Bootstrap

Before Terraform can manage anything, a small set of resources must exist. These are created once, manually, in the management account and documented as a runbook:

1. AWS Organization and member accounts (management, production, staging)
2. S3 bucket and DynamoDB table for Terraform state (in management account)
3. OIDC identity provider for GitHub Actions (in management account)
4. IAM roles that GitHub Actions assumes for Terraform operations (one per account, with cross-account trust)
5. ECR repository (in management account — cross-account pull policies added by Terraform later)

This is approximately 30–45 minutes of setup. Attempting to Terraform-bootstrap Terraform adds complexity without meaningful benefit at this scale.

---

## Phasing

Infrastructure as code is not a separate migration phase — it is the implementation mechanism for each phase:

| Migration Phase                 | Terraform Work                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Phase 1: Foundation & Database  | `management` environment (ECR, Route 53, CloudTrail, OIDC) + `production/vpc` + `production/rds` + SES |
| Phase 2: Backend Service        | `production/ecs-service` + ALB + cross-account ECR pull policy + monitoring                            |
| Phase 3: Data Pipelines         | EventBridge rules + ECS scheduled task definitions                                                     |
| Phase 4: Frontend Migration     | `production/cdn` + S3 buckets                                                                          |
| Phase 6: Cutover & Environments | `staging` environment — same modules, smaller values                                                   |

Each phase: write the modules, open a PR, review the plan output, merge to apply. Infrastructure grows incrementally.

---

## What We Skip

| Tool/Pattern                     | Why Not                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Terragrunt**                   | Adds a dependency and abstraction layer; not needed at this scale (~15 resources per environment)  |
| **Workspaces**                   | Separate directories per environment is clearer and avoids accidental cross-environment operations |
| **Complex module registry**      | Local modules in the same repository are sufficient                                                |
| **Import of existing resources** | Greenfield AWS deployment — nothing to import                                                      |
