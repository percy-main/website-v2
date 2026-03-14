# Decision 009: Functional Dependency Injection

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Use functional injection for all service dependencies. No module-level singletons, no DI container, no mocking of module imports.

## Pattern

Services are curried factories that accept their dependencies as the first parameter:

```typescript
// service.ts
export function listUsers(db: Kysely<DB>) {
  return async (params: ListUsers) => {
    return db.selectFrom("user")...
  };
}

// routes.ts — wire up at registration time
export const adminRoutes: FastifyPluginAsync = async (app) => {
  const list = listUsers(app.db);

  app.get("/admin/users", { preHandler: [requireRole("admin")] }, async (req) => {
    return list(parseQuery(req, listUsersSchema));
  });
};
```

## Infrastructure

- **Config**: `parseConfig(env: Record<string, string>) => Config` — zod-validated, accepts any env object
- **DB client**: `createClient(connectionString) => { client, dialect, pool }` — pure factory, no singleton
- **Fastify decorations**: `app.db`, `app.config`, `app.auth` — created once at startup
- **Tests**: Pass `ctx.db` from testcontainers directly to service factories — zero mocking, zero process.env mutation

## Options rejected

### vi.mock / vi.doMock
Fragile, requires hoisting workarounds (`vi.hoisted`), fights with module caching, fails when vitest changes pooling behaviour. The whole point of testcontainers is to avoid mocking.

### Module-level singleton with process.env
```typescript
// BAD — reads env at import time, impossible to override cleanly in tests
const client = createClient(process.env.DATABASE_URL!);
export { client };
```

### DI container (Awilix, tsyringe, etc.)
Over-engineered for this project. Function parameters are simpler, type-safe, and have zero runtime overhead.

## Why this matters

- Tests call `listUsers(testContainerDb)({page: 1})` — no mocking, no env vars, no singletons
- Config is validated at startup, not scattered across import.meta.env / process.env reads
- The Fastify instance owns the lifecycle of all dependencies
- Adding a new dependency is just another function parameter, not a framework concept
