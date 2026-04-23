---
name: add-adr
description: Record an Architecture Decision Record (ADR) in docs/adrs/ — for non-obvious decisions, especially when rejecting a reasonable alternative. Documents the decision, options considered, rationale, and rejected paths.
metadata:
  tags: adr, architecture, docs, decisions
---

# Add ADR

Record an architectural decision as an ADR in `docs/adrs/`.

## When to Use

Write an ADR when:

- Making a non-obvious architectural decision
- Rejecting a reasonable-looking alternative in favour of something else
- Picking between two tools/libraries/patterns that both have real trade-offs
- The decision shapes future work and someone will later ask "why did we do it this way?"

**Don't** write one for routine implementation choices, obvious-best-practice patterns, or decisions fully covered by an existing ADR.

## File naming

Sequential three-digit prefix, kebab-case slug:

```
docs/adrs/NNN-short-title.md
```

The next number is one higher than the highest existing file — check with:

```sh
ls docs/adrs/ | grep -E '^[0-9]{3}-' | sort | tail -1
```

## Format

Match the existing ADR style. Required sections:

```markdown
# Decision NNN: Short Title

**Date:** YYYY-MM-DD
**Status:** Accepted

## Decision

One paragraph: what we decided, in plain terms.

## Problem

What forced the decision? What was wrong with doing nothing or continuing the status quo?

## Options considered

Brief treatment of each realistic option, including the chosen one.

## Rationale

Why the chosen option won. Include concrete constraints (cost, complexity, team size, existing infra).

## Rejected alternatives

For each rejected option: the reason, and what would have to change for it to become attractive later.
```

Some ADRs have additional sections (architecture diagrams, database roles, rollback plans) — add them when they add value. See `docs/adrs/012-prod-db-access.md` for an example of a richer ADR.

## After writing

1. Update `docs/adrs/README.md` — add a one-line row for the new ADR in the index table.
2. If the decision changes how I should work on common tasks, update the relevant skill so the new rule is discoverable at task-time (not just retrievable via grep).
3. Commit the ADR and any skill updates together.

## Supersession

If a new ADR replaces an older one, set the old ADR's `**Status:**` to `Superseded by NNN` and add a link. Don't delete superseded ADRs — the history is the point.
