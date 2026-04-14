# Project: Percy Main Community Sports Club — v2 Monorepo

## Stack

- **Monorepo** — pnpm workspaces
- **API** — Fastify v5, TypeScript, Kysely ORM
- **Frontend** — React + Vite SPA (Phase 4 — scaffold only for now)
- **Database** — PostgreSQL 16 (RDS in production, Docker Compose locally, testcontainers in tests)
- **Email** — React Email templates, Amazon SES (production), file writer (dev)
- **Auth** — better-auth (passkeys, 2FA, Google OAuth, email/password)
- **Payments** — Stripe (subscriptions, one-off payments, webhooks)
- **Infrastructure** — Terraform (AWS: ECS Fargate, RDS, S3, CloudFront, SES, Route 53)
- **CI/CD** — GitHub Actions

## Workspace Layout

```
percy-main/
├── apps/
│   ├── api/              # Fastify API service (backend)
│   └── web/              # React + Vite SPA (frontend — Phase 4)
├── packages/
│   ├── shared/           # Zod schemas, types, constants
│   ├── db/               # Kysely client factory, migrations, generated types
│   └── email/            # React Email templates + send logic
├── infra/                # Terraform modules + environments
├── decisions/            # Architecture Decision Records
├── .github/workflows/    # CI/CD pipelines
└── docker-compose.yml    # Local PostgreSQL
```

## Architecture Principles

### Functional Dependency Injection

No module-level singletons. All dependencies are injected via function parameters.

**Services** are curried factories:

```typescript
export function listUsers(db: Kysely<DB>) {
  return async (params: ListUsers) => {
    return db.selectFrom("user")...
  };
}
```

**Routes** use `FastifyPluginAsyncZod` with Fastify schema declarations:

```typescript
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

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

**Tests** pass dependencies directly — no mocking of modules:

```typescript
const result = await listUsers(ctx.db)({ page: 1, pageSize: 10 });
```

### Config

Environment config is parsed and validated with Zod at startup:

```typescript
const config = parseConfig(process.env); // production
const config = parseConfig({ DATABASE_URL: "...", NODE_ENV: "test" }); // tests
```

Never read `process.env` directly in service or route code. Access config through `app.config`.

### Fastify Decorations

The Fastify instance owns all shared dependencies:

- `app.db` — Kysely client (created from config at startup)
- `app.config` — parsed Config object
- `app.auth` — better-auth instance

## Generated Files — DO NOT EDIT MANUALLY

| Files                                 | Generator                         | Command                     |
| ------------------------------------- | --------------------------------- | --------------------------- |
| `packages/db/src/__generated__/db.ts` | kysely-codegen (DB schema)        | `pnpm run db:types`         |
| `apps/web/src/lib/api.gen.json`       | @fastify/swagger (OpenAPI spec)   | `pnpm run openapi:generate` |
| `apps/web/src/lib/api.gen.d.ts`       | openapi-typescript (typed client) | `pnpm run openapi:generate` |

After creating a new migration, run:

```sh
docker compose up -d                    # start local PostgreSQL
pnpm run db:up                         # apply migrations
pnpm run db:types                      # regenerate types
```

The generator introspects the schema from the running PostgreSQL database.

After adding or changing a route's schema, regenerate the OpenAPI spec and typed client:

```sh
pnpm run openapi:generate              # regenerate spec + frontend types
```

## Coding Standards

- **All incoming data is Zod-validated via Fastify schema declarations** — declare `schema: { querystring, body, params, response }` on routes using Zod schemas. Fastify validates automatically via `fastify-type-provider-zod`. Do not use `parseBody`/`parseQuery`/`parseParams` — use `request.body`, `request.query`, `request.params` directly (typed by the schema declaration). Never use Fastify's inline generics (`app.get<{ Params: { id: string } }>`) — this is a type assertion, not validation.
- **Every route must have a response schema** — declared in `schemas.ts` and referenced in the route's `schema.response`. This drives the OpenAPI spec and the generated typed frontend client. After adding/changing response schemas, run `pnpm run openapi:generate`.
- **Frontend API calls use the typed client** — import `{ api, callApi }` from `@/lib/api-client`. Use `callApi(api.GET("/api/path", { params: { query: {...} } }))`. Never use raw `fetch` or define local response type interfaces — types are generated from the OpenAPI spec.
- **Use `getAuthSession(request)` for authenticated routes** — imported from `auth/middleware.js`. Returns typed session or throws 401. Never use `request.authSession!` or inline null checks.
- **Use react-query for data fetching in React components** — no raw `fetch` in `useEffect`
- **Use shadcn/ui components where possible** — compose smaller components into larger ones
- **Use `NULL` for unset/missing values** — never empty string `""` for "no value"
- **Services take `db: Kysely<DB>` as first parameter** — never import a client singleton
- **PostgreSQL aggregates return bigint (string in node-pg)** — use `sql<string>` (not `sql<number>`) for all aggregate expressions (`SUM`, `COUNT`, `MAX`, `COALESCE(SUM(...))`, etc.) so the type honestly reflects what node-pg returns. Then wrap in `Number()` when converting to a JS number. Using `sql<number>` lies to TypeScript and causes the lint rule `@typescript-eslint/no-unnecessary-type-conversion` to flag the `Number()` call as redundant.
- **No `process.env` in services or routes** — use `app.config` via Fastify decoration
- **Use `return await` in async route handlers** — preserves stack traces for error debugging
- **Always add imports and their usage in the same edit** — lint hooks run on save and will strip unused imports. Never add an import in one edit and its usage in a separate edit.

## Content Pages (MDX)

The site has a file-based content page system for static informational pages. See `docs/content.md` for full documentation on how to create and structure content pages (file location, frontmatter, available MDX components, navigation). Use this when creating prose-heavy pages like announcements, codes of conduct, or club information — no router changes or code generation needed.

## Feature Folder Structure

Each API feature is self-contained:

```
apps/api/src/features/<feature>/
├── routes.ts              # Fastify route handlers (thin — schema, delegate, respond)
├── service.ts             # Business logic (curried factories, testable without HTTP)
├── schemas.ts             # Zod request + response schemas (drives OpenAPI spec)
├── service.test.ts        # Unit tests (mock DB)
└── integration.test.ts    # Integration tests (testcontainers)
```

## Database

- **Client factory**: `createClient(connectionString)` from `@percy-main/db` — no singleton
- **Migrations**: `packages/db/src/migrations/` — Kysely `up()` functions
- **Migration timestamps**: Use unique ISO timestamps with full millisecond precision
- **Migration defaults**: Use `sql\`CURRENT_TIMESTAMP\``— not`datetime('now')` (PostgreSQL, not SQLite)
- **Types**: Auto-generated by `kysely-codegen` into `packages/db/src/__generated__/db.ts`

### Creating a migration

```sh
pnpm run db:migration    # creates timestamped file in packages/db/src/migrations/
# edit the migration
pnpm run db:up           # apply
pnpm run db:types        # regenerate types
```

## Testing

### Unit tests (`pnpm --filter api test`)

- Mock the DB with `vi.hoisted()` + Proxy pattern
- Call curried services directly: `listUsers(mockDb)({page: 1})`
- Fast — no Docker required
- Config: `vitest.config.ts`

### Integration tests (`pnpm --filter api test:integration`)

- **testcontainers** — each test file gets its own PostgreSQL container
- Pass `ctx.db` to service factories — no mocking, no `process.env` mutation
- Config: `vitest.integration.config.ts` (forks pool for process isolation)
- Requires Docker

```typescript
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
```

### Running all tests

```sh
pnpm --filter api test              # unit tests only (fast, no Docker)
pnpm --filter api test:integration  # integration tests (needs Docker)
pnpm --filter api test:all          # both
```

## AWS CLI

All AWS CLI commands must use the `percy-main` profile: `aws --profile percy-main ...`

## Local Development

```sh
docker compose up -d          # start PostgreSQL on port 5433
pnpm install                  # install all workspace deps
pnpm run db:up                # apply migrations
pnpm run dev:api              # start API on port 3000
pnpm run dev:web              # start frontend on port 5173 (proxies /api to :3000)
```

Each app/package has its own `.env.example` documenting required environment variables. Copy to `.env` in the same directory and fill in values. Currently only `apps/api/` needs a `.env` file.

## Development Workflow

Work on one feature at a time directly in the main repo (no worktrees).

1. **Read the ticket** — GitHub issues are the source of truth. Read body + comments.

2. **Create a feature branch** — branch from `main`, include ticket number (e.g. `18-add-user-profile`).

3. **Analyse current behaviour** — understand existing code before changing it.

4. **Clarify with the user** — make pragmatic decisions for ambiguities, note assumptions.

5. **Build a plan** — identify files to create/modify, break into steps, consider tests.

6. **Execute** — commit frequently, ensure lint + test + typecheck pass locally.

7. **Pre-PR verification** — before opening a PR, run the full CI check suite locally: `pnpm run typecheck && pnpm run lint && pnpm format:check && pnpm --filter api test`. Fix any issues before proceeding.

8. **Open a PR** — against `main`, include `Closes #N`.

9. **Review** — use a code-reviewer agent. Instruct it to read files locally (not via WebFetch). Post comments on the PR.

10. **Address review comments** — commit fixes, reply to each comment.

11. **Finalise** — ensure all CI checks pass and review comments are addressed.

12. **Report** — notify user with summary and PR link.

## Key Scripts

| Command                              | Description                     |
| ------------------------------------ | ------------------------------- |
| `pnpm run dev`                       | Start all services in parallel  |
| `pnpm run dev:api`                   | Start API only                  |
| `pnpm run dev:web`                   | Start frontend only             |
| `pnpm run build`                     | Build all packages              |
| `pnpm run typecheck`                 | Type-check all packages         |
| `pnpm run lint`                      | Lint all packages               |
| `pnpm --filter api test`             | Run API unit tests              |
| `pnpm --filter api test:integration` | Run API integration tests       |
| `pnpm run db:up`                     | Run database migrations         |
| `pnpm run db:types`                  | Regenerate DB types             |
| `pnpm run db:migration`              | Create new migration file       |
| `pnpm run openapi:generate`          | Regenerate OpenAPI spec + types |
| `docker compose up -d`               | Start local PostgreSQL          |

## OpenAPI Type Safety (ADR #11)

End-to-end type safety from database to frontend via OpenAPI spec generation.

### How it works

1. **Backend routes declare Zod schemas** for querystring, body, params, and response
2. `@fastify/swagger` + `fastify-type-provider-zod` generates an OpenAPI spec from those schemas
3. `openapi-typescript` generates TypeScript types from the spec
4. `openapi-fetch` provides a typed HTTP client that uses those types
5. `callApi()` wraps the client to throw on errors and return typed data

### Adding a new endpoint

1. Add request + response schemas to `schemas.ts`
2. Declare the route with `schema: { querystring, body, params, response: { 200: schema } }`
3. Run `pnpm run openapi:generate` to regenerate types
4. Use `callApi(api.GET("/api/path"))` on the frontend — types are inferred

### Backend route pattern

```typescript
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { myQuerySchema, myResponseSchema } from "./schemas.ts";

export const myRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/my-route",
    {
      schema: {
        querystring: myQuerySchema,
        response: { 200: myResponseSchema },
      },
    },
    async (request) => {
      const { page, limit } = request.query; // fully typed
      return await myService(request.query);
    },
  );
};
```

### Frontend usage pattern

```typescript
import { api, callApi } from "@/lib/api-client";

// In react-query hooks:
const { data } = useQuery({
  queryKey: ["my-data"],
  queryFn: () =>
    callApi(
      api.GET("/api/my-route", {
        params: { query: { page: 1, limit: 10 } },
      }),
    ),
});
// data is fully typed from the OpenAPI spec

// With path params:
callApi(
  api.GET("/api/games/{matchId}", {
    params: { path: { matchId } },
  }),
);

// POST with body:
callApi(
  api.POST("/api/contact", {
    body: { name, email, message, page },
  }),
);
```

### Swagger UI

Available at `/api/docs` in non-production environments.

## Migration Context (from v1)

This repo is a greenfield rewrite of the Percy Main website, migrating from:

- Astro + React islands → React + Vite SPA
- Netlify → AWS (ECS Fargate, RDS, S3, CloudFront)
- SQLite/Turso → PostgreSQL
- Mailgun → Amazon SES
- Contentful CMS → inline React components (Phase 5)

The v1 repo continues to serve production. This repo builds the replacement incrementally.
See `docs/adrs/` for Architecture Decision Records and `docs/aws/` in v1 for the migration plan.

## Architecture Decision Records

ADRs are in `docs/adrs/`. When making a non-obvious architectural decision — especially when rejecting a reasonable alternative — record it as an ADR with the rationale. Use the existing format: decision, options considered, rationale, and rejected alternatives with reasons.
