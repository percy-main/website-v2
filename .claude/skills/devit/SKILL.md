---
name: devit
description: Fetches GitHub issues ready for development and works through them using the standard CLAUDE.md workflow, with parallel orchestration where appropriate.
metadata:
  tags: github, issues, development, orchestration
---

# Dev It

Fetch GitHub issues and develop them end-to-end using the standard project workflow.

## When to Use

Use this skill when the user wants to:

- Develop one or more GitHub issues
- Work through the backlog of issues marked `ready for dev`
- Implement a specific issue by number

## Arguments

This skill takes an optional variadic argument: one or more issue numbers (e.g. `/devit 42 43 57`).

- If issue numbers are provided, only those issues are considered.
- If no arguments are provided, all applicable open issues are fetched.

## Workflow

### Step 1: Fetch and categorise issues

Fetch open issues from GitHub:

```bash
gh issue list --state open --json number,title,labels,body,comments,assignees --limit 100
```

If specific issue numbers were provided, filter to only those issues.

Categorise each issue:

| Category      | Condition                 | Action                 |
| ------------- | ------------------------- | ---------------------- |
| **Skip**      | Has `backlog` label       | Ignore entirely        |
| **Ready**     | Has `ready for dev` label | Proceed to development |
| **Not ready** | No `ready for dev` label  | Report status to user  |

For issues that are **not ready**, advise the user what's needed (clarification or triage).

### Step 2: Present the plan

Present a summary table and wait for user confirmation before proceeding.

### Step 3: Develop issues

**Before creating any branches**, pull the latest `main`:

```bash
git fetch origin main && git merge origin/main --ff-only
```

For each issue, follow the **full development workflow from CLAUDE.md**:

1. Read the ticket thoroughly (body + all comments)
2. Create a feature branch and worktree at `@.worktrees/` (branch name includes issue number)
3. Install dependencies (`pnpm install`) in the worktree
4. Analyse current behaviour
5. Clarify ambiguities (make pragmatic decisions, note assumptions)
6. Build a plan — identify affected packages (`apps/api`, `packages/db`, etc.)
7. Execute the plan:
   - Follow the functional DI pattern — services as curried factories
   - Write unit tests (mock DB) and integration tests (testcontainers) for new service functions
   - Commit frequently, ensure lint + typecheck + test pass locally
8. Open a PR against `main` (include `Closes #N`)
9. Review the PR using a code-reviewer agent (instruct it to read files locally)
10. Address review comments
11. Finalise the PR (checks pass, reviews addressed)
12. Clean up (stop processes, delete worktree)
13. Report to user with summary and PR link

**Do NOT merge PRs** — only prepare them for the user's review and approval.

### Monorepo-specific considerations

- **Identify affected packages first** — changes to `packages/shared` affect both `apps/api` and `apps/web`
- **Run typecheck across the full monorepo** (`pnpm typecheck`) — not just the changed package
- **Migrations** go in `packages/db/src/migrations/` — regenerate types after with `pnpm run db:types`
- **Services follow the curried factory pattern** — `(db: Kysely<DB>) => (params) => result`
- **Routes wire services from `app.db`** — no direct DB imports in route handlers
- **Config access via `app.config`** — no `process.env` in services or routes
- **Integration tests use testcontainers** — pass `ctx.db` to service factories directly
- **New features get a full feature folder** — `routes.ts`, `service.ts`, `schemas.ts`, tests

### Parallel execution

When multiple issues are being developed:

- Use **team orchestration** (TeamCreate + Agent tool) to work on independent issues in parallel
- Each issue gets its own worktree and feature branch
- The orchestrator monitors progress, handles conflicts, and collects results

### Step 4: Final summary

Present a summary with PR links for each developed issue.

## Guidelines

- Follow all conventions from CLAUDE.md
- Never commit directly to `main`
- Never merge PRs
- Run `pnpm install` in each new worktree
- Use unique migration timestamps with full millisecond precision
- Keep the user informed of progress
