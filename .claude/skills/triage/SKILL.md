---
name: triage
description: Triages open GitHub issues by reading each ticket, exploring the codebase, drafting a brief implementation plan, identifying uncertainties, and posting the plan and questions as a comment on the issue.
metadata:
  tags: github, issues, triage, planning
---

# Triage

Triage open GitHub issues by reading each one, understanding what's needed, drafting a brief implementation plan, and posting it back to the ticket.

## When to Use

Use this skill when the user wants to:

- Triage open issues
- Plan work across outstanding tickets
- Prepare issues for development

## Workflow

### Step 1: Fetch open issues

Use `gh` to list open issues, excluding any with the `backlog` label:

```bash
gh issue list --state open --json number,title,labels,body,comments,assignees --limit 100
```

Filter out issues where any label name is `backlog`.

All applicable issues should be triaged.

### Step 2: Triage each issue

For each issue being triaged:

1. **Read the issue thoroughly** — body, all comments, labels, and any linked PRs
2. **Explore the codebase** — search for relevant files, understand current behaviour, trace the code paths involved. Use Glob, Grep, and Read tools to build a clear picture. Be thorough here — a good plan requires understanding the existing code.
3. **Draft a plan** — write a concise implementation plan:
   - Which workspace package(s) are affected (`apps/api`, `apps/web`, `packages/db`, etc.)
   - What needs to change (files to create/modify)
   - Key implementation steps in order
   - Any migrations, type regeneration, or build steps needed
   - Testing approach (unit tests, integration tests with testcontainers, or both)
4. **Identify uncertainties** — note anything that's ambiguous, has multiple valid approaches, or needs user/stakeholder input before work can begin. Be specific.

### Step 3: Post the triage comment

Post a comment on each issue using `gh issue comment`. Use this format:

```markdown
## Triage

### Affected packages

- `apps/api` — ...
- `packages/db` — ...

### Plan

- Step 1: ...
- Step 2: ...
- ...

### Open questions

- [ ] Question 1?
- [ ] Question 2?

---

_Triaged by Claude_
```

If there are no open questions, omit that section entirely.

**Important:** Do not modify the issue title or assignees — only add a comment.

### Step 4: Categorise

Set the issue type and add appropriate labels. Always add the `triaged` label.

| Label           | Description                         |
| --------------- | ----------------------------------- |
| `backlog`       | Not for right now                   |
| `bug`           | Something isn't working             |
| `enhancement`   | New feature or request              |
| `triaged`       | This issue has been triaged         |
| `ready for dev` | This issue is ready for development |

### Step 5: Summarise

After triaging all issues, present a summary table to the user.

## Guidelines

- Keep plans brief and actionable — 4-8 steps is ideal.
- Reference specific files and line numbers where relevant.
- Consider the project's conventions (CLAUDE.md) when planning — functional DI pattern, curried services, testcontainers, zod validation.
- If an issue already has a triage comment from a previous run, skip it unless the user explicitly asks to re-triage.
- Process issues sequentially, not in parallel.
