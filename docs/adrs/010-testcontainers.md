# Decision 010: Testcontainers for Integration Tests

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Use `@testcontainers/postgresql` for integration tests. Each test file gets its own PostgreSQL container with a fresh, migrated database.

## Pattern

```typescript
import {
  startTestContainer,
  stopTestContainer,
  type TestContext,
} from "../../test/containers.js";
import { getMemberDetails } from "./service.js"; // static import — no mocking needed

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContainer();
}, 30_000);

afterAll(async () => {
  await stopTestContainer(ctx);
});

it("returns member details", async () => {
  const getDetails = getMemberDetails(ctx.db); // pass container's db directly
  const result = await getDetails("test@example.com");
  expect(result).toBeNull();
});
```

## Why not shared test database with cleanup?

The previous approach used a shared test DB with `cleanDb()` between tests. Problems:

- Tests can interfere with each other if cleanup is incomplete
- Parallel test execution is impossible
- Module-level DB singletons required process.env hacks
- `cleanDb` had to enumerate every table in dependency order — fragile

## Test types

| Type        | Pattern                                | Config file                    | Runs in CI      |
| ----------- | -------------------------------------- | ------------------------------ | --------------- |
| Unit        | Mock db with vi.fn, test service logic | `vitest.config.ts`             | Always          |
| Integration | Real PostgreSQL via testcontainers     | `vitest.integration.config.ts` | Docker required |

Integration tests use `pool: "forks"` for process-level isolation — each test file gets its own Node process, its own module instances, and its own container.

## Container performance

- PostgreSQL 16 Alpine starts in ~2-3 seconds
- Migrations run in <1 second (single baseline migration)
- 7 integration test files × ~3s startup = ~21s total overhead
- Acceptable for CI; fast enough for local development
