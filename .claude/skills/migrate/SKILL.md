---
name: migrate
description: Picks a migration task from the status checklist, plans and executes it interactively with the user, including testing, ADRs, and code review.
metadata:
  tags: migration, planning, development, orchestration
---

# Migrate

Work through the next piece of the v1 → v2 migration, end-to-end.

## When to Use

Use this skill when the user wants to:

- Tackle the next migration task
- Port a specific feature or component from v1
- Work on a specific unchecked item from the migration status checklist

## Arguments

Optional free-text argument describing what the user wants to migrate (e.g. `/migrate stripe webhook logic`, `/migrate email templates`).

- If an argument is provided, use it to guide task selection.
- If no argument is provided, analyse what should come next.

## Workflow

### Step 1: Read migration status and assess what's next

Read the migration status checklist:

```
docs/migration-status.md
```

Identify all unchecked (`- [ ]`) items. Group them by phase and assess which are ready to work on based on:

- **Dependencies** — does this task depend on other unchecked items being done first?
- **Impact** — does completing this unblock other work?
- **Phase ordering** — earlier phases should generally complete before later ones
- **Scope** — is this a single-session task or does it need breaking down?

### Step 2: Propose and confirm the task

If the user specified what to work on (via argument), confirm that task. Otherwise, present the top 2-3 candidates with a brief rationale for each and ask the user which to tackle.

Use `AskUserQuestion` to confirm. For example:

> Based on the migration status, here are the next candidates:
>
> 1. **Port full Stripe webhook handler logic** — Phase 2, unblocks payment testing
> 2. **Port email template content from v1** — cross-cutting, low risk, independent
> 3. **React Router route definitions** — Phase 4, unblocks frontend work
>
> Which would you like to work on? (Or suggest something else.)

### Step 3: Examine existing codebase

Before planning, thoroughly understand the current state:

1. **Read the v1 implementation** — find the equivalent code in `@../website` (the v1 repo). Trace the full code path: entry points, business logic, data access, templates, tests.
2. **Read the v2 codebase** — understand what's already been ported, what patterns are in place, and what infrastructure exists. Check for partial implementations or stubs.
3. **Identify the gap** — what exactly needs to be built, adapted, or rewritten?
4. **Check for relevant ADRs** — read `docs/adrs/` for any decisions that affect this work.

Use Explore agents or Glob/Grep/Read tools to do this thoroughly. Do not skip this step.

### Step 4: Build the plan

Create a detailed implementation plan. The plan MUST cover:

#### Required plan sections

1. **What's being migrated** — clear scope statement
2. **Files to create or modify** — specific paths in the v2 repo
3. **Implementation steps** — ordered list of changes
4. **Adaptation needed** — what changes from v1 patterns to v2 patterns:
   - SQLite → PostgreSQL query differences
   - Astro actions → Fastify routes
   - Singleton imports → functional DI (curried factories)
   - `process.env` → `app.config`
   - Mailgun → SES
   - Contentful → inline React components
5. **Testing strategy**:
   - Unit tests (mock DB, test business logic)
   - Integration tests (testcontainers, test full data flow)
   - What edge cases to cover
6. **Security considerations** — auth checks, input validation, data exposure
7. **Scaling and reliability** — error handling, idempotency, rate limits, timeouts
8. **Documentation** — any docs that need updating

#### Plan quality checks

- Does every new service follow the curried factory pattern?
- Does every route use Zod schema validation?
- Are there integration tests using testcontainers?
- Is config accessed via `app.config`, not `process.env`?
- Are PostgreSQL-specific patterns used (not SQLite)?

### Step 5: Present the plan and clarify

Present the full plan to the user. Ask specific questions about any ambiguities. Use `AskUserQuestion` for each decision point.

Common questions to consider:

- Are there v1 behaviours that should change in v2?
- Are there features that can be simplified or removed?
- Are there new requirements not in v1?
- Should this be behind a feature flag?

Do NOT proceed until the user confirms the plan.

### Step 6: Record architectural decisions

If the plan involves any non-obvious architectural decisions — especially when rejecting a reasonable alternative — record them as ADRs in `docs/adrs/`.

Follow the existing format (see `docs/adrs/` for examples):

```markdown
# Decision NNN: Title

**Date:** YYYY-MM-DD
**Status:** Accepted

## Decision

What we decided.

## Why

The reasoning.

## Alternatives considered

What we rejected and why.
```

Use the next sequential number for the ADR filename.

### Step 7: Execute the plan

Follow the **full development workflow from CLAUDE.md**:

1. Create a feature branch (e.g. `migrate-stripe-webhooks`)
2. Execute each step from the plan:
   - Follow functional DI pattern — services as curried factories
   - Write unit tests and integration tests alongside the code
   - Commit frequently with clear messages
3. After each significant step, verify:
   ```bash
   pnpm run typecheck
   pnpm --filter api test
   pnpm --filter api test:integration  # if integration tests were added
   ```

#### Monorepo-specific rules

- Changes to `packages/shared` affect both `apps/api` and `apps/web` — run full typecheck
- Migrations go in `packages/db/src/migrations/` — regenerate types after with `pnpm run db:types`
- Services take `db: Kysely<DB>` as first parameter
- Routes wire services from `app.db`
- Config access via `app.config`
- Integration tests use testcontainers — pass `ctx.db` to service factories
- New features get a full feature folder: `routes.ts`, `service.ts`, `schemas.ts`, tests

### Step 8: Verify everything passes

Run the full verification suite:

```bash
pnpm run typecheck
pnpm run lint
pnpm --filter api test
pnpm --filter api test:integration
pnpm run build
```

All must pass. Fix any failures before proceeding.

### Step 9: Code review

Launch a **code-reviewer agent** to review the changes. Instruct it to:

- Read files locally (not via WebFetch)
- Check for bugs, security issues, and adherence to project conventions
- Verify the functional DI pattern is followed
- Verify tests are meaningful (not just smoke tests)
- Check for PostgreSQL-specific issues (bigint aggregates, boolean handling, etc.)

Address all review findings. Commit fixes.

### Step 10: Update migration status

Update `docs/migration-status.md` — check off (`- [x]`) the completed item(s).

### Step 11: Open PR and report

Open a PR against `main`:

```bash
gh pr create --title "..." --body "..."
```

Include in the PR body:

- Summary of what was migrated
- Link to any new ADRs
- Test plan
- Any follow-up work identified

**Do NOT merge the PR** — leave it for the user's review.

Present a final summary to the user:

- What was migrated
- Key decisions made
- Any new ADRs created
- PR link
- Follow-up items (if any)

## Guidelines

- Follow all conventions from CLAUDE.md
- Never commit directly to `main`
- Never merge PRs
- Keep the user informed and involved — this is collaborative, not autonomous
- Prefer small, focused migrations over large sweeping changes
- If a task is too large for one session, propose breaking it down and only tackle the first piece
- When porting from v1, adapt to v2 patterns — do not copy v1 code verbatim
- Always check the v1 repo (`@../website`) for the source implementation
