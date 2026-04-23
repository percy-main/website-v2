---
name: add-migration
description: Create a PostgreSQL database migration using Kysely — scaffold the migration file, write the up() function, apply, and regenerate DB types.
metadata:
  tags: database, migration, kysely, postgresql
---

# Add Migration

Create a Kysely migration, apply it, and regenerate the generated DB types so TypeScript sees the new schema.

## When to Use

- Adding, altering, or dropping tables, columns, indexes, or constraints
- Seed data that must run in every environment

Background context in [ADR 003 — Baseline Migration Strategy](../../../docs/adrs/003-baseline-migration-strategy.md) and [ADR 005 — Generated DB Types](../../../docs/adrs/005-generated-types-approach.md).

## Workflow

### 1. Start local PostgreSQL (if not already running)

```sh
docker compose up -d
```

Local PostgreSQL runs on port 5433.

### 2. Scaffold the migration file

```sh
pnpm run db:migration
```

Creates a timestamped file in `packages/db/src/migrations/` using ISO timestamps with full millisecond precision (e.g. `2026-04-22T14-07-03.152Z-<description>.ts`). Timestamps must be unique.

### 3. Write the `up()` function

Use Kysely's schema builder. The DB is PostgreSQL — use `sql\`CURRENT_TIMESTAMP\``for timestamp defaults (never`datetime('now')` — that's SQLite).

```typescript
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("membership_period")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("member_id", "uuid", (col) =>
      col.notNull().references("member.id").onDelete("cascade"),
    )
    .addColumn("starts_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn("ends_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("membership_period_member_id_idx")
    .on("membership_period")
    .column("member_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("membership_period").execute();
}
```

Use `NULL` (no default, nullable column) for unset/missing values — never empty string `""` for "no value".

### 4. Apply the migration

```sh
pnpm run db:up
```

### 5. Regenerate DB types

```sh
pnpm run db:types
```

This runs `kysely-codegen` against the running local PostgreSQL and writes `packages/db/src/__generated__/db.ts`. Never hand-edit that file.

### 6. Commit both

Commit the migration file **and** the regenerated `__generated__/db.ts` together.

## Schema drift

If `db:types` produces output that doesn't match what you expect, the cause is almost always a missing migration, an un-applied migration, or a `packages/db` version mismatch — **not** something to fix by `ALTER TABLE`-ing the database directly. Trace the root cause.

## Related

- [ADR 003 — Baseline Migration Strategy](../../../docs/adrs/003-baseline-migration-strategy.md)
- [ADR 005 — Generated DB Types](../../../docs/adrs/005-generated-types-approach.md)
- [ADR 010 — Testcontainers](../../../docs/adrs/010-testcontainers.md) — how migrations run in integration tests
