# Decision 057: Reviewer-Gated Terraform PR Plans Instead of a De-scoped Plan Role

**Date:** 2026-08-20
**Status:** Accepted

## Decision

Credentialed Terraform plans for pull requests run only after a human approves
the workflow run via a GitHub environment (`terraform-plan`, required
reviewers). The plan role's OIDC trust policy accepts the
`environment:terraform-plan` subject and `ref:refs/heads/main` (drift
detection), and no longer trusts the bare `pull_request` subject. Untrusted PR
validation that runs automatically (`terraform fmt -check`,
`terraform validate` with `-backend=false` init) carries no cloud credentials
at all, and a CI guard fails any PR that reintroduces an OIDC trust for the
`pull_request` subject in `infra/`.

## Problem

The plan workflow triggered on `pull_request` with `id-token: write`, and the
plan role's trust policy accepted the `repo:<repo>:pull_request` OIDC subject
(#626, severity critical). Terraform evaluates PR-controlled configuration at
plan time, so any PR job GitHub permitted to run could add a provider or data
source that exfiltrated the role's credentials or the secret values it could
read. The role legitimately held `secretsmanager:GetSecretValue` on
`*percy-main*` secrets because production reads the Tailscale OAuth secret via
a `data` block at plan time and refreshes managed secret versions, and it was
exempted from the production master-secret deny policy because state refresh
on the secret resource requires it.

## Options considered

1. **Gate who can trigger a credentialed plan (chosen).** Point the plan job
   at a protected GitHub environment with required reviewers; restrict the
   role's trust policy to that environment's OIDC subject. Unreviewed PR code
   never receives a token; a maintainer eyeballs the diff before releasing
   each plan run. Fast no-credential checks still run automatically on every
   infra PR.

2. **De-scope the plan role.** Keep the `pull_request` trust but strip
   Secrets Manager access (and re-add the master-secret deny), accepting that
   plans lose the plan-time secret reads.

3. **Drop PR plans entirely.** Only plan on main (drift + deploy). Zero PR
   exposure, but infra changes would merge without any plan output, and
   apply-time failures on main become the first feedback.

## Rationale

De-scoping the role does not contain the blast radius it appears to. A real
plan requires reading remote state, and the state file itself contains every
secret value Terraform has ever written (RDS master credentials, managed
secret versions), so any role that can run a real plan can read secrets
regardless of a Secrets Manager deny. The trust edge - who can assume the role
at all - is the only boundary that actually holds, so the fix restricts that
edge rather than the permission set. Gating keeps full-fidelity plans
(including plan-time secret reads) on every infra PR at the cost of one
approval click per run; the no-credential validate job keeps automatic fast
feedback. Dependabot infra PRs lose auto-plan, but those plans already failed
on the missing `NEW_RELIC_API_KEY` secret, so the practical loss is nil.

## Rejected alternatives

- **De-scoped PR plan role (option 2):** rejected because state read defeats
  the deny (above). It becomes attractive only once plan-time secret reads
  are out of the configuration entirely (e.g. Tailscale OAuth creds supplied
  via workflow env or an apply-time SSM pattern) _and_ plans can run against
  a state snapshot with secret values redacted or a mock backend - that is
  the long-term path to safe unattended PR plans.
- **No PR plans (option 3):** rejected because plan output on the PR is the
  primary review artefact for infra changes; losing it trades a critical but
  fixable exposure for permanently worse change review.

## Limitations

The trust policy proves only that the run targets an environment _named_
`terraform-plan`. The protection rules on that environment (required
reviewers) live in GitHub repo settings, not in Terraform - deleting and
recreating the environment without protection rules, or removing the
reviewers, silently removes the human gate while the trust policy keeps
working. Changing those settings requires repo admin, which in this repo is
the same person doing the reviewing, so the residual risk is accepted. If
the admin surface ever widens, manage the environment declaratively via the
`github` Terraform provider so protection-rule drift shows up in plans.
