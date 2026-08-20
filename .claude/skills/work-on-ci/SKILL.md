---
name: work-on-ci
description: Add, modify, or debug GitHub Actions workflows for this monorepo - the reusable lint/test/build gate, the PR-only guardrails, the main deploy pipeline, Terraform jobs, drift checks, and the Turborepo caching pattern that ties them together.
metadata:
  tags: ci, github-actions, workflows, turbo, deploy
---

# Work on CI

Use this skill when adding, modifying, or debugging anything under `.github/workflows/` or `.github/actions/`.

## Workflow layout

```
.github/
├── actions/
│   ├── setup-deps/        # Composite: pnpm + Node 24 + frozen install
│   ├── tf-unlock/         # Releases stale Terraform state locks
│   └── notify-deploy-failure/
└── workflows/
    ├── ci.yml                       # PR gate. Calls _lint-test-build.yml + PR-only guardrails.
    ├── deploy.yml                   # Push-to-main gate. Calls _lint-test-build.yml, then path-filter,
    │                                # then Terraform shared/production, then build/push images, deploy.
    ├── _lint-test-build.yml         # Reusable. format-check / lint / typecheck / unit-tests /
    │                                # integration-tests / build / openapi-drift, plus publish-test-results.
    ├── terraform.yml                # PR checks for infra/ changes (no apply): uncredentialed
    │                                # fmt/validate + OIDC-subject guard run automatically; the
    │                                # credentialed plan waits for approval on the terraform-plan
    │                                # environment (ADR 057) and is the ONLY PR-triggered job
    │                                # allowed cloud credentials or secrets.
    ├── terraform-drift.yml          # Scheduled drift detection.
    ├── deploy-api-manual.yml        # Manual API redeploy (workflow_dispatch).
    ├── deploy-web-manual.yml        # Manual web redeploy.
    ├── deploy-terraform-manual.yml  # Manual Terraform apply, gated on production env.
    ├── rotate-secrets-reminder.yml  # Scheduled reminder.
    └── labeler.yml                  # PR auto-labelling.
```

## When deciding where a new check belongs

| Need                                                                       | Put it in                                   |
| -------------------------------------------------------------------------- | ------------------------------------------- |
| Runs on every PR AND on every main deploy (lint, test, drift checks)       | `_lint-test-build.yml` as a new fan-out job |
| PR-only guardrail (diffs `origin/${{ github.base_ref }}`, comments on PRs) | `ci.yml`                                    |
| Touches Terraform / infra (plan or apply)                                  | `terraform.yml` or `deploy.yml` infra jobs  |
| Triggered by humans on demand                                              | New `deploy-*-manual.yml`                   |
| Scheduled / cron                                                           | New top-level workflow with `on.schedule`   |

Reusable shared jobs go in `_lint-test-build.yml` because both `ci.yml` (PR) and `deploy.yml` (main deploy) invoke it via `uses: ./.github/workflows/_lint-test-build.yml`. A check that fails in `ci.yml` blocks merge; a check that lives only in `deploy.yml` runs after merge and is too late.

## Fan-out pattern

Each lint/test/build step in `_lint-test-build.yml` is its own job that runs in parallel:

```yaml
lint:
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v6
      with:
        persist-credentials: false
    - uses: ./.github/actions/setup-deps
    - uses: actions/cache@v5
      with:
        path: .turbo
        key: turbo-${{ runner.os }}-lint-${{ github.sha }}
        restore-keys: |
          turbo-${{ runner.os }}-lint-
    - run: pnpm lint
```

The keys:

1. **`actions/checkout@v6` with `persist-credentials: false`** - jobs run arbitrary PR code (lint plugins, test files, build scripts). Drop the git token from the runner so a malicious PR can't push back to the repo.
2. **`./.github/actions/setup-deps`** - composite action that installs pnpm@11.1.2, Node 24, and runs `pnpm install --frozen-lockfile` with the pnpm-store cache. Use it instead of inlining the three steps.
3. **`actions/cache@v5` keyed `turbo-${{ runner.os }}-<task>-${{ github.sha }}`** - per-task Turborepo cache. The `restore-keys: turbo-${{ runner.os }}-<task>-` fallback hits the latest cache for that task when the exact SHA misses (which is most PR pushes).
4. **`permissions: contents: read`** - default; jobs only get more when they need it.

## The permissions / artefact split

Jobs that execute PR code (lint, test, build) get `contents: read` only. JUnit XML is uploaded via `actions/upload-artifact@v7`. A separate `publish-test-results` job downstream:

- runs after all test jobs (`needs: [...]`)
- has elevated permissions (`checks: write`, `pull-requests: write`)
- does **not** check out the PR code
- downloads the JUnit XML artefacts and posts results back to the PR

This prevents a malicious PR from getting hold of a token that can write to the repo or the checks API. Mirror this pattern for any new job that needs to comment on a PR.

## Turborepo cache in CI

Tasks that have `outputs` defined in `turbo.json` are cached. The CI `.turbo` cache pattern survives across PR pushes. Three idioms to know:

1. **Standard task** - outputs live in the same package as the script. Default behaviour, nothing special:

   ```jsonc
   "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] }
   ```

2. **Cross-package codegen task** - the script writes files into sibling packages (e.g. an OpenAPI generator producing typed clients in `apps/web` and `apps/matchday`). Use `$TURBO_ROOT$` to address files relative to the repo root:

   ```jsonc
   "api#openapi": {
     "inputs": [
       "src/**/*.ts",
       "$TURBO_ROOT$/packages/shared/src/**",
       "$TURBO_ROOT$/packages/db/src/**"
     ],
     "outputs": [
       "$TURBO_ROOT$/apps/web/src/lib/api.gen.json",
       "$TURBO_ROOT$/apps/web/src/lib/api.gen.d.ts"
     ]
   }
   ```

   The script lives in `apps/api/package.json` and uses relative paths (`../web/src/lib/...`). On a cache hit, turbo restores every output file in milliseconds, even ones outside the package directory.

3. **Drift check** - a CI guardrail that asserts committed generated files are up to date:
   ```yaml
   - uses: actions/cache@v5
     with:
       path: .turbo
       key: turbo-${{ runner.os }}-openapi-${{ github.sha }}
       restore-keys: |
         turbo-${{ runner.os }}-openapi-
   - run: pnpm openapi:generate # turbo-cached
   - run: git diff --exit-code -- <gen files>
   ```
   On a cache hit the regen restores the same bytes that are committed, so the diff is empty and the job passes. On a real drift, regen produces different bytes and the diff fails with an `::error::` annotation explaining what to run locally.

## Action version policy

**Every third-party action is pinned to a full 40-char commit SHA**, with a trailing `# vX.Y.Z` comment naming the release that SHA belongs to:

```yaml
- uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
```

A version-tag ref (`@v6`, `@main`) is mutable: the maintainer can retarget the tag at any commit, including a malicious one (the [tj-actions/changed-files compromise, March 2025](https://github.com/marketplace/actions/tj-actions/changed-files) exfiltrated secrets from thousands of repos this way), and a moving `@main` can ship a breaking change mid-flight (which is what broke `react-doctor` in PR #353). A SHA is immutable, so neither can happen. Auth, payments, and infra-deploy secrets (`AWS_*`, `STRIPE_*`, `BETTER_AUTH_*`, `NEW_RELIC_*`) flow through these workflows, so this is the policy for **all** external actions, including first-party `actions/*` from GitHub.

The trailing `# vX.Y.Z` comment is not decoration: Dependabot reads it to know which release the SHA maps to, and opens a PR (bumping both SHA and comment) when upstream tags move. The `github-actions` ecosystem is enabled in `.github/dependabot.yml`, so this stays maintained without manual effort.

To pin (or bump) an action, resolve the tag to a commit SHA and find the matching release tag:

```sh
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha   # -> the 40-char SHA
```

The code snippets elsewhere in this skill abbreviate refs to `@v6` etc. for readability - the real workflow files are SHA-pinned, and any new ref you add must be too.

Exceptions, which stay as bare `./` refs (they are first-party and resolved from the repo's own tree, not downloaded): internal composite actions under `./.github/actions/*` and the reusable `./.github/workflows/_lint-test-build.yml`.

One action carries a SHA with **no** `# vX.Y.Z` comment: `millionco/react-doctor` in `ci.yml`. It is deliberately pinned to an untagged commit on the maintainer's `main` (a recovery point from the PR #353 incident, sitting between releases), so there is no release tag to name. Dependabot can't auto-bump it while it's off a tag - the inline comment above the `uses:` line explains the situation. Re-pin it to a tagged release (with the `# vX.Y.Z` comment) once the upstream `--pr-comment` gap closes.

GitHub also deprecates Node 20 actions on a rolling schedule (forced to Node 24 from June 2026, Node 20 removed September 2026). When a deprecation annotation appears, bump to the SHA of the latest major.

## Hooks and gotchas

- **AWS CLI in workflows must include `--profile percy-main`** locally; in CI it's role-assumption via `aws-actions/configure-aws-credentials`. A local PreToolUse Bash hook (`.claude/hooks/check-aws-profile.sh`) enforces the profile - in CI the role-assume step does.
- **No em dashes anywhere in workflow files, scripts, or commit messages** (per [feedback_no_em_dashes](../../../../.claude/projects/-Users-alexyoung-Code-website-v2/memory/feedback_no_em_dashes.md)). They break AWS IAM validation in some Terraform contexts and are a tell. Use `-` instead.
- **Run `pnpm format` before pushing** PR-bound branches. CI's `format-check` job will fail otherwise. Yes, this applies to `.github/workflows/*.yml` too - prettier formats them.
- **Concurrency groups cancel in-progress runs** on PR refs (`cancel-in-progress: true` in `ci.yml`). On `main` deploys the group exists but does **not** cancel - infra changes need to finish or roll back cleanly.
- **`defaults.run.shell: "bash -euo pipefail {0}"`** is set on every workflow. `set -e` means an unguarded grep with no matches fails the step; use `grep ... || true` or `grep -c ...` when zero matches is acceptable.

## Verifying a workflow change

Before pushing:

```sh
pnpm format                  # workflow YAML is prettier-formatted
pnpm format:check            # confirm
```

Optional but recommended for non-trivial changes:

```sh
gh workflow list             # see what's registered
gh workflow view <name>      # YAML lint via GitHub
```

For changes to `_lint-test-build.yml`, push the branch and open a draft PR - both `ci.yml` (PR gate) and a manual `deploy.yml` run (if you have permissions) will exercise the reusable workflow.

## Drift-check template

When you need to enforce that a generated file in the repo matches what the generator produces, add a job in `_lint-test-build.yml`:

```yaml
<thing>-drift:
  # Guardrail: <generated files> are produced by `pnpm <command>`.
  # Regenerate them in CI and fail if the committed copies drift, so a
  # contributor who forgets the regen can't merge a PR whose generated
  # output lies about the source of truth.
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v6
      with:
        persist-credentials: false
    - uses: ./.github/actions/setup-deps
    - uses: actions/cache@v5
      with:
        path: .turbo
        key: turbo-${{ runner.os }}-<thing>-${{ github.sha }}
        restore-keys: |
          turbo-${{ runner.os }}-<thing>-
    - name: Regenerate
      run: pnpm <command>
    - name: Verify committed copies match
      run: |
        if ! git diff --exit-code -- <paths>; then
          echo ""
          echo "::error::<thing> generated files are out of date. Run 'pnpm <command>' locally and commit the result."
          exit 1
        fi
```

If the regenerator is a turbo task (it should be, for caching), the `actions/cache@v5` step gives you per-task incremental builds across PR pushes. If it isn't, drop the cache step and consider turbo-ifying it - see the cross-package codegen idiom above.

## Related

- [ADR 011 - API Type Safety](../../../docs/adrs/011-api-type-safety.md) - why OpenAPI drift matters
- `_lint-test-build.yml` - the canonical fan-out + cache patterns
- `.github/actions/setup-deps/action.yml` - the composite install action
- `turbo.json` - task graph + `$TURBO_ROOT$` examples
