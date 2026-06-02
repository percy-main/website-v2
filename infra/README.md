# infra

Terraform-managed AWS infrastructure for Percy Main. Reusable `modules/` composed by per-environment stacks in `environments/`.

## Layout

- `environments/shared/` — account-wide, environment-independent resources: Route 53 zone, ECR, SES identity, ACM certificates, the Terraform state backend, and the GitHub Actions OIDC IAM roles. **Apply this first** — the app environments read its outputs via `terraform_remote_state`.
- `environments/production/` and `environments/staging/` — the full application stack per environment (VPC, RDS, ECS service, CDN, monitoring, scheduled tasks). Staging is a smaller-footprint mirror of production.
- `modules/` — building blocks (`vpc`, `rds`, `ecs-service`, `cdn`/`spa-cdn`, `dns`, `monitoring`, `scheduling`, `tailscale-router`, and the various S3 bucket/upload modules). Each environment wires these together.

## State & providers

- State lives in an S3 backend (eu-west-2) with DynamoDB locking; each environment is an independent state file.
- Two AWS regions: eu-west-2 (everything) and a us-east-1 alias (CloudFront certs + Route 53 metrics).
- Tailscale (production only) and New Relic (shared only) providers are also configured.

## Apply

CI owns apply — there is **no routine manual `terraform apply`**:

- PRs touching `infra/` get a `terraform plan` posted as a comment (per environment).
- Merges to `main` apply `shared` then the app environments, gated on a GitHub environment approval.
- A daily drift check re-plans against `main`.

All AWS CLI use requires the `percy-main` profile (`aws --profile percy-main ...`); a hook blocks commands that omit it. `pnpm test` here runs Terraform unit tests (vitest).

## Non-obvious notes

- **DB credential separation** (ADR 043): master credentials are break-glass only and audited; the app uses an `app_rw` role and migrations use `app_ddl`. Operator read access is via Tailscale to RDS with `sslmode=require` — see [ADR 012](../docs/adrs/012-prod-db-access.md).
- **No NAT Gateway** — ECS tasks run in public subnets with public IPs (cost trade-off). VPC flow logs capture REJECTs only.
- **Secrets** referenced by the ECS task definition (DB URL, API keys, etc.) must already exist in Secrets Manager before a deploy, or task startup fails.
- **Matchday CDN/DNS** is not in the Route 53 zone; its CNAME is managed manually.
- Keep [ADRs](../docs/adrs/) in mind before changing topology — several of these decisions are recorded there. Avoid conditional `count`/`for_each` driven by new module outputs.
