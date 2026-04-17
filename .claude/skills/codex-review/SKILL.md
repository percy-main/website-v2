---
name: codex-review
description: Run a code review of the current branch using the OpenAI Codex CLI. Returns structured feedback on bugs, security issues, and convention adherence without running tests or linting.
metadata:
  tags: review, codex, openai, code-quality
---

# Codex Review

Use the OpenAI Codex CLI to review code changes on the current branch against `main`.

## When to Use

Use this skill when the user wants to:

- Get a second-opinion code review from Codex/OpenAI
- Review a PR or branch before merging
- Cross-check code with a different model

## Workflow

1. Run `codex exec --full-auto` with a review prompt.
2. Present the feedback to the user.
3. If Codex finds issues, offer to fix them.

## Invocation

```bash
codex exec --full-auto "Review the code changes on the current branch. Read the changed files locally using git diff main...HEAD. Do NOT run any tests, linting, type checking, or any other commands — just read the code and provide review feedback. Focus on bugs, logic errors, security issues, and adherence to the project conventions in CLAUDE.md. Return your feedback as a structured review."
```

## Guidelines

- Do NOT run tests, linting, or type checking — Codex should only read code
- Present the raw Codex output to the user
- If Codex finds issues, offer to fix them
