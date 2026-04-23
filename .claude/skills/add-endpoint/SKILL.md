---
name: add-endpoint
description: Add or change a Fastify API endpoint — Zod request/response schemas, route registration with FastifyPluginAsyncZod, curried service, OpenAPI spec regeneration, and typed frontend client usage.
metadata:
  tags: api, fastify, zod, openapi, routes
---

# Add Endpoint

Add a new API endpoint or modify an existing one end-to-end (backend route + schema + typed frontend client).

## When to Use

- Adding a new route under `apps/api/src/features/<feature>/routes.ts`
- Changing an existing route's querystring, body, params, or response shape
- Exposing an existing service through a new HTTP endpoint

Rationale for this pattern is recorded in [ADR 011 — API Type Safety](../../../docs/adrs/011-api-type-safety.md).

## Feature folder layout

```
apps/api/src/features/<feature>/
├── routes.ts              # Fastify route handlers (thin — schema, delegate, respond)
├── service.ts             # Curried factories: `fn(db) => async (params) => ...`
├── schemas.ts             # Zod request + response schemas
├── service.test.ts        # Unit tests (mock DB)
└── integration.test.ts    # Integration tests (testcontainers)
```

## Workflow

### 1. Define Zod schemas in `schemas.ts`

Every endpoint needs both request and response schemas. Response schemas drive the generated OpenAPI spec.

```typescript
import { z } from "zod";

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const listUsersResponseSchema = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string().email(),
      createdAt: z.string().datetime(),
    }),
  ),
  total: z.number().int().nonnegative(),
});
```

### 2. Write the service as a curried factory in `service.ts`

Services take `db: Kysely<DB>` as the first parameter — never import a client singleton.

```typescript
import type { Kysely } from "kysely";
import type { DB } from "@percy-main/db";
import type { z } from "zod";
import { sql } from "kysely";
import type { listUsersSchema } from "./schemas.ts";

export function listUsers(db: Kysely<DB>) {
  return async (params: z.infer<typeof listUsersSchema>) => {
    const offset = (params.page - 1) * params.pageSize;
    const [users, [{ total }]] = await Promise.all([
      db
        .selectFrom("user")
        .select(["id", "email", "createdAt"])
        .orderBy("createdAt", "desc")
        .limit(params.pageSize)
        .offset(offset)
        .execute(),
      db
        .selectFrom("user")
        .select(sql<string>`COUNT(*)`.as("total"))
        .execute(),
    ]);
    return { users, total: Number(total) };
  };
}
```

**PostgreSQL aggregates** (`SUM`, `COUNT`, `MAX`, `COALESCE(SUM(...))`) return bigint — use `sql<string>` and wrap in `Number()`. Using `sql<number>` lies to TypeScript and the lint rule `@typescript-eslint/no-unnecessary-type-conversion` will flag the `Number()` call.

### 3. Register the route in `routes.ts`

Use `FastifyPluginAsyncZod` and declare schemas on the route. Never use Fastify's inline generics (`app.get<{ Params: {...} }>`) — that's a type assertion, not validation.

```typescript
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { listUsers } from "./service.ts";
import { listUsersSchema, listUsersResponseSchema } from "./schemas.ts";

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const list = listUsers(app.db);

  app.get(
    "/admin/users",
    {
      schema: {
        querystring: listUsersSchema,
        response: { 200: listUsersResponseSchema },
      },
    },
    async (request) => {
      return await list(request.query);
    },
  );
};
```

Use `return await` in async handlers so stack traces include the route.

### 4. Authenticated routes — use `getAuthSession`

```typescript
import { getAuthSession } from "../auth/middleware.js";

app.get("/admin/users", { schema: {...} }, async (request) => {
  const session = await getAuthSession(request); // typed, throws 401
  return await list(request.query);
});
```

Never use `request.authSession!` or inline null checks — `getAuthSession` does that and throws the right error.

### 5. Regenerate the OpenAPI spec + frontend client

```sh
pnpm run openapi:generate
```

This regenerates `apps/web/src/lib/api.gen.json` and `apps/web/src/lib/api.gen.d.ts`. Both are generated — never hand-edit.

### 6. Consume from the frontend via the typed client

```typescript
import { useQuery } from "@tanstack/react-query";
import { api, callApi } from "@/lib/api-client";

const { data } = useQuery({
  queryKey: ["admin-users", page],
  queryFn: () =>
    callApi(
      api.GET("/api/admin/users", {
        params: { query: { page, pageSize: 20 } },
      }),
    ),
});
// data is fully typed from the OpenAPI spec
```

Never use raw `fetch` or define local response type interfaces — types are generated from the OpenAPI spec. With path params:

```typescript
callApi(api.GET("/api/games/{matchId}", { params: { path: { matchId } } }));
```

With a POST body:

```typescript
callApi(api.POST("/api/contact", { body: { name, email, message, page } }));
```

## Verification

Before committing:

```sh
pnpm run typecheck
pnpm run lint
pnpm --filter api test
```

Swagger UI is available at `/api/docs` in non-production to sanity-check the generated spec.

## Related

- [ADR 001 — API Framework (Fastify)](../../../docs/adrs/001-api-framework.md)
- [ADR 009 — Functional Dependency Injection](../../../docs/adrs/009-dependency-injection.md)
- [ADR 011 — API Type Safety](../../../docs/adrs/011-api-type-safety.md)
- For tests, see the `write-tests` skill.
