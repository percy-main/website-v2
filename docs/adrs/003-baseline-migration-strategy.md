# Decision 003: Baseline Migration Strategy — Single Consolidated Migration

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Consolidate all 47 SQLite migrations from v1 into a **single baseline PostgreSQL migration** in the new repo, rather than porting each migration individually.

## Options Considered

### Single consolidated migration (chosen)
- Produces clean, readable schema definition
- Avoids carrying forward historical SQLite workarounds (e.g., no-op migrations, column recreation patterns that were necessary because SQLite doesn't support ALTER COLUMN)
- The new repo has no migration history to preserve
- Data migration will be handled by a separate lift tool (as planned in Phase 1)

### Port each migration individually
- Preserves full migration history
- More work (47 files to review and port)
- Many migrations would need significant rewriting for PostgreSQL compatibility
- Historical context is preserved in v1's git history

### Kysely schema-only export
- Generate schema from the current SQLite database
- Loses intent and constraints that aren't always inferrable

## Rationale

This is a new repo with a new database engine — there's no existing PostgreSQL database to migrate incrementally. A single baseline migration is clearer, easier to review, and starts the new repo with a clean slate. The v1 repo preserves the full migration history for reference.

## Key PostgreSQL changes from SQLite
- Integer booleans (0/1) → native `boolean` type
- `autoIncrement()` → `serial` type
- `CURRENT_TIMESTAMP` default works in both (no change needed)
- JSON → `jsonb` for query-able JSON storage
- Connection pooling via `pg.Pool` (SQLite had no pooling)
