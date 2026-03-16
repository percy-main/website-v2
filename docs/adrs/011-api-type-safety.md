# Decision 011: API Type Safety Between Backend and Frontend

**Date:** 2026-03-16
**Status:** Accepted

## Decision

Adopt a two-phase approach to API type safety:

1. **Now:** Shared Zod response schemas in `packages/shared/src/api/`, used by both backend routes and frontend query functions.
2. **Later:** OpenAPI spec generation from Fastify routes via `@fastify/swagger` + `fastify-type-provider-zod`, with a generated typed client replacing manual frontend types.

## Problem

The frontend uses `api.get<ManualType>(path)` for all API calls. The generic parameter is a type assertion — it has no connection to what the backend actually returns. This caused a runtime bug where `GET /play-cricket/teams` returns `{ teams: [...] }` but the frontend typed it as `Team[]`, which would crash when accessing `.filter()` on the response object.

With 67 API routes and growing, manual type duplication between backend and frontend is unsustainable.

## Phase 1: Shared Zod response schemas

Place API response schemas in `packages/shared/src/api/`, organised by feature. Both sides import and use them:

```typescript
// packages/shared/src/api/play-cricket.ts
import { z } from "zod";

export const teamsResponseSchema = z.object({
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_junior: z.boolean(),
    }),
  ),
});

export type TeamsResponse = z.infer<typeof teamsResponseSchema>;
```

**Backend** — return type is validated by construction (Kysely query shape matches the schema). Optionally `schema.parse()` the return value for defence in depth.

**Frontend** — validate at the call site:

```typescript
const { data } = useQuery({
  queryKey: ["play-cricket-teams"],
  queryFn: async () =>
    teamsResponseSchema.parse(await api.get("/play-cricket/teams")),
});
```

This catches shape mismatches at runtime during development rather than silently producing wrong types.

### Rules

- Every new API endpoint must have a response schema in `packages/shared/src/api/`.
- Frontend `api.get<T>()` calls must not use locally-defined interfaces for response types — import from `@percy-main/shared`.
- Existing endpoints are backfilled as they are touched.

## Phase 2: OpenAPI generation + typed client

Once response schemas are on most routes, wire up:

1. `fastify-type-provider-zod` — register Zod schemas as Fastify route schemas.
2. `@fastify/swagger` — auto-generate `openapi.json` from the registered schemas.
3. `openapi-typescript` + `openapi-fetch` — generate a typed client from the spec.

This makes the backend route definition the single source of truth. The frontend client is auto-generated with path, method, and response types all validated at compile time. The shared Zod schemas from Phase 1 become the route schema declarations — no wasted work.

## Alternatives considered

### tRPC

Best-in-class type safety with zero codegen — procedures are imported directly, giving end-to-end type inference. However:

- Requires rewriting all 67 routes as tRPC procedures — large migration
- Couples frontend and backend tightly (must share TypeScript)
- Loses REST semantics (HTTP caching, standard tooling, non-TS consumers)
- Fastify adapter is less mature than Next.js integration
- The curried factory DI pattern needs adapting to tRPC's context model

**Verdict:** Too costly to retrofit. Would be the pick for a greenfield project.

### GraphQL (Mercurius + codegen)

Strong schema typing and flexible queries, but:

- Largest migration effort of all options
- Adds resolver complexity, N+1 concerns, schema stitching
- Overkill for this app's data patterns (mostly simple CRUD, no deep graphs)
- No clear benefit over OpenAPI for the query shapes we have

**Verdict:** Wrong tool for this project's needs.

### Do nothing (status quo)

Keep `api.get<ManualType>()` with locally-defined interfaces.

- Zero effort but guarantees more bugs like the teams response shape mismatch
- Type assertions give false confidence — TypeScript says it's correct but runtime disagrees
- Gets worse as the API surface grows

**Verdict:** Unacceptable given the bug rate we've already seen.
