# Decision 004: better-auth Database Type — postgres

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Configure better-auth with `type: "postgres"` and pass the shared Kysely PostgresDialect.

## Context

The v1 codebase uses `type: "sqlite"` with `LibsqlDialect`. The migration to PostgreSQL requires updating this configuration. better-auth supports both SQLite and PostgreSQL natively — it uses the Kysely dialect to generate appropriate SQL.

## Changes

```diff
- database: { type: "sqlite", dialect: db.dialect }
+ database: { type: "postgres", dialect }
```

No other auth configuration changes are required. better-auth's schema (user, session, account, verification, passkey, twoFactor tables) is included in the baseline migration with PostgreSQL-native types (e.g., `boolean` instead of `integer` for `emailVerified`).
