# Security Policy

## Supported versions

Only `main` (the deployed branch) is supported. There are no released
versions or back-ports.

## Reporting a vulnerability

If you've found a security issue in this codebase or any of the
services it operates (api.v2.percymain.org, v2.percymain.org), please
**do not open a public GitHub issue**.

Instead, report privately via one of:

- **Email:** alex@alexyoung.info — encrypt with PGP if you have it,
  otherwise plain email is fine
- **GitHub Security Advisory:** use the "Report a vulnerability"
  button on the [Security tab](https://github.com/percy-main/website-v2/security/advisories/new)
  of this repository

Please include:

- A description of the vulnerability and the affected component
- Reproduction steps or a proof-of-concept
- The impact you believe it has
- Your name / handle so we can credit you (or "anonymous" — your call)

## What to expect

- **Acknowledgement** within 3 working days
- An initial **assessment** (severity, scope) within 7 working days
- A **fix or mitigation** target depending on severity:
  - Critical (auth bypass, RCE, mass data exposure): hours-to-days
  - High: 1-2 weeks
  - Medium / low: best-effort, typically rolled into the next sprint
- A **disclosure timeline** agreed with you before any public write-up

## Scope

In scope:

- This repository's source code
- The deployed services it operates
- Configuration in `infra/` (Terraform-managed AWS infra)

Out of scope:

- Third-party services we depend on (Stripe, AWS, New Relic, Play
  Cricket, Google Maps) — please report directly to the vendor
- Social engineering of club members or volunteers
- Physical access to club facilities

## Secret rotation

External-service credentials stored as GitHub Actions secrets / variables are rotated **annually at minimum**, and **immediately** after any of: a known or suspected compromise, an outgoing collaborator who had access, or a vendor advisory recommending rotation.

A quarterly reminder issue is auto-opened by [`.github/workflows/rotate-secrets-reminder.yml`](.github/workflows/rotate-secrets-reminder.yml) so the cadence stays visible. Don't dismiss it without either rotating or filing the next dated TODO.

| Secret / variable | Scope | What it does | Rotation procedure |
| --- | --- | --- | --- |
| `MAPS_API_KEY` (secret) | Repo | Google Maps JS SDK key for the public site map | Google Cloud Console → APIs & Services → Credentials → "Maps JS API key" → Regenerate. Update repo secret. Old key remains valid for ~5 min while CDN caches drain. |
| `NEW_RELIC_API_KEY` (secret) | Repo | NR User key for the Terraform provider (cloud_aws_link_account, integrations) and the `changeTrackingCreateDeployment` GraphQL calls in deploy workflows | NR UI → Account dropdown → API keys → User key → "Rotate". Update repo secret. NR keeps the old key valid for 30 days for graceful overlap. |
| `NEW_RELIC_ACCOUNT_ID` (variable) | Repo | NR account number — not sensitive, but documented here for completeness | Doesn't rotate; only changes if we move account. |
| `SLACK_WEBHOOK_URL` (secret) | `production` env | Incoming webhook for the deploy-failure / contact-form / incident-report Slack notifier | Slack workspace → Apps → Incoming Webhooks → revoke + recreate. Update env secret. |
| `DEPLOY_ROLE_ARN` / `TERRAFORM_ROLE_ARN` / `TERRAFORM_PLAN_ROLE_ARN` (variables) | Repo | OIDC-assumed AWS role ARNs — not credentials, just identifiers | Don't rotate; only change if the role itself is recreated. The OIDC trust relationship is the actual auth boundary. |
| `STRIPE_PUBLIC_KEY` (variable) | Repo | Publishable Stripe key (intentionally public — embedded in the web bundle) | Rotate from Stripe dashboard if compromised; not on a schedule. |
| `NEW_RELIC_BROWSER_LICENSE_KEY` (variable) | `production` env | NR Browser ingest key (intentionally public — embedded in the web bundle per NR's design) | NR UI → Browser app → Settings → "Generate new". Update env variable. |

**Stripe restricted/secret keys, AWS root credentials, and the database password are not stored in GitHub Actions** — they live in AWS Secrets Manager / Stripe dashboard / RDS-managed-password and are accessed at runtime. Rotation procedures for those live in the runbook (TBD), not here.

## Safe harbour

Good-faith security research is welcome. We will not pursue legal
action against researchers who:

- Make a reasonable effort to avoid privacy violations and service
  disruption
- Report findings privately and give us reasonable time to fix them
  before public disclosure
- Do not exfiltrate or retain data beyond what's needed to demonstrate
  the issue
