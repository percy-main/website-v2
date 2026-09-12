---
name: write-tests
description: Write API unit or integration tests — unit tests with hoisted DB mocks (fast, no Docker), integration tests with testcontainers (real PostgreSQL per file).
metadata:
  tags: testing, vitest, testcontainers, integration, unit
---

# Write Tests

Two test tiers live side-by-side under `apps/api/src/features/<feature>/`:

- **Unit tests** (`service.test.ts`) — mock the DB, call curried services directly, fast, no Docker.
- **Integration tests** (`integration.test.ts`) — real PostgreSQL via testcontainers, one container per test file.

Functional DI is what makes both tiers trivial — services take `db` as a parameter, so tests just pass a different one. Background: [ADR 009 — Functional Dependency Injection](../../../docs/adrs/009-dependency-injection.md), [ADR 010 — Testcontainers](../../../docs/adrs/010-testcontainers.md).

## Unit tests

Use unit tests when the logic under test is pure or only depends on DB calls whose shape you can easily stub. Config: `vitest.config.ts`.

```typescript
import { describe, expect, it, vi } from "vitest";
import { listUsers } from "./service.ts";

describe("listUsers", () => {
  it("paginates results", async () => {
    const mockDb = vi.hoisted(() => {
      const target: Record<string, unknown> = {};
      // The `get` trap must check the target for an explicitly-set property
      // (like `execute` below) before falling back to the chain-returning
      // function — an unconditional fallback also shadows `.then`, which
      // makes `await mockDb...` hang forever (a real Promise checks
      // `typeof thenable.then === "function"` and awaits its non-existent
      // callback). `then` itself must return `undefined` explicitly, not
      // fall through to the same fallback — `"then" in t` is also false,
      // so without this case `await chain` directly (not `await
      // chain.execute()`) hangs the same way.
      const chain: any = new Proxy(target, {
        get: (t, prop) =>
          prop === "then"
            ? undefined
            : prop in t
              ? t[prop as string]
              : (...args: unknown[]) => chain,
      });
      chain.execute = vi.fn().mockResolvedValue([{ id: "u1" }]);
      return chain;
    });

    const result = await listUsers(mockDb as any)({ page: 1, pageSize: 10 });
    expect(result.users).toHaveLength(1);
  });
});
```

Run:

```sh
pnpm --filter api test
```

## Integration tests

Use integration tests when you need to exercise real SQL, migrations, or cross-table behaviour. Each test file gets its own PostgreSQL container (forks pool isolates processes). Config: `vitest.integration.config.ts`.

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/test-container.ts";
import { createMember } from "./service.ts";

describe("createMember (integration)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestContainer();
  }, 30_000);

  afterAll(async () => {
    await stopTestContainer(ctx);
  });

  it("creates a member", async () => {
    const create = createMember(ctx.db);
    const result = await create({ email: "test@example.com" });
    expect(result.id).toBeDefined();
  });
});
```

Pass `ctx.db` directly to the curried service — no mocking, no `process.env` mutation. The container's migrations run on startup, so the schema is real.

Run (requires Docker):

```sh
pnpm --filter api test:integration
```

Run both:

```sh
pnpm --filter api test:all
```

## Rules

- **Never mock integration tests.** If you find yourself reaching for `vi.mock()` in an integration test, it belongs in `service.test.ts` instead.
- **Never mutate `process.env`** in tests. Build a `Config` object and pass it in; or pass `ctx.config` from the test container.
- **PostgreSQL, not SQLite.** Migration defaults use `sql\`CURRENT_TIMESTAMP\``, not `datetime('now')`.
- **Don't mock the DB to dodge a failing integration test.** Mock-passing / prod-failing has bitten the project before — fix the integration test instead.

## Pre-PR verification

```sh
pnpm run typecheck && pnpm run lint && pnpm format:check && pnpm --filter api test
```

Run `test:integration` too if you touched anything DB-related.
