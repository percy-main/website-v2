# ADR 035: Terraform — record apply-time plan in step summary, not pinned `tfplan` artifact

## Status

Accepted

## Context

The post-merge `terraform apply` jobs (`deploy.yml` `terraform-shared` / `terraform-production`, plus their `deploy-terraform-manual.yml` counterparts) used to run `terraform apply -auto-approve` directly. The PR-time `terraform plan` was posted to the PR as a comment but never persisted; the apply did a fresh resolve, and any drift between PR-time and apply-time (manual console change, parallel-merged module output) was silently re-resolved.

Issue #227 raised this and presented two options:

- **A. Saved `tfplan` artifact.** PR job uploads `plan.tfplan` (binary). Main job downloads and runs `terraform apply tfplan` against the same artifact. Requires identical Terraform + provider versions between the two jobs (in practice, pin via tooling or trust the version pin is enforced).
- **B. Plan-then-apply visible to approver.** Run `terraform plan -no-color -out=tfplan` inside the gated apply job, dump the plan to `$GITHUB_STEP_SUMMARY`, then `terraform apply -auto-approve tfplan` to apply that exact plan.

## Decision

Adopt **Option B**, with the apply consuming the locally-saved `tfplan` from the same job step:

1. `Terraform Plan` step writes `tfplan` and `plan.txt` in the working directory.
2. `Plan summary` step (always-run) tails the last 200 lines of `plan.txt` into the step summary so the actual apply-time plan is visible in the run page (and via `gh run view --log`).
3. `Terraform Apply` step runs `terraform apply -auto-approve -no-color tfplan`, applying the same binary plan that was just summarised.

Reviewer approval flow stays as today: reviewers consult the PR's plan comment when approving the gated `terraform-shared` / `terraform-production` job. Once approval lands, the run captures and applies the plan-then-apply pair atomically, so any drift between PR-time and apply-time appears in the step summary for post-hoc audit (and shows up the next day in the drift-detection workflow if it persists).

## Why option B over A

**Option A is more rigorous but adds operational cost.** The saved-`tfplan` flow needs identical Terraform + provider versions across the PR run and the main run, plus an artifact-storage hop. We pin Terraform to `1.7` in workflow env vars, and providers via `.terraform.lock.hcl`, but a mismatch slipping through silently corrupts the apply — failure modes include refusing to run with "plan was created with X" or, worse, mis-applying. For a one-person ops team the surface area isn't worth the marginal rigour.

**Option B's residual risk is bounded by drift detection.** The window where a PR-time plan and an apply-time plan can diverge is small (between merge and the gated job starting). The new daily drift-detection workflow (#228) catches anything that survives the merge-to-apply gap and persists, opening a GitHub issue for triage.

**The reviewer gate already exists.** The terraform-production environment carries the required-reviewer list; #226 added the same gate to terraform-shared. The reviewer is the structural defence against an unwanted apply — the apply-time plan summary is a record-of-what-ran, not a second approval gate.

## Rejected

- **Option A (saved `tfplan` artifact)** — see above. Reconsider if the team grows or if a PR-vs-apply divergence ever causes a real incident.
- **Two-job split (non-gated `plan` → gated `apply` consuming artifact).** Split jobs would let the reviewer see the apply-time plan before approving, but suffer the same version-pinning fragility as Option A's artifact hop, and add a job-graph layer that's awkward when `terraform-production` `needs:` `terraform-shared` (which would itself need to split into plan + apply).

## Consequences

- The `Terraform Plan` step in each gated job adds ~10–30 s to the deploy.
- Reviewers approving the gated job are still approving based on the PR's plan; the apply-time plan in the step summary is for audit, not for pre-approval review.
- A PR-merged change whose plan no longer applies (e.g. a hand-edit removed the resource being modified) will be caught by the apply-time plan failing, rather than partially applying.
