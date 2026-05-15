# Project: Percy Main Community Sports Club — v2 Monorepo

pnpm monorepo with a Fastify API, React + Vite SPA, PostgreSQL 16, better-auth, Stripe, React Email + SES, and Terraform-managed AWS infrastructure (ECS Fargate, RDS, S3, CloudFront, SES, Route 53). CI/CD via GitHub Actions.

Human-facing setup and scripts are in [`README.md`](../README.md). Architectural decisions are in [`docs/adrs/`](../docs/adrs/).

## Workspace Layout

```
percy-main/
├── apps/
│   ├── api/              # Fastify API service (backend)
│   └── web/              # React + Vite SPA (frontend)
├── packages/
│   ├── shared/           # Zod schemas, types, constants
│   ├── db/               # Kysely client factory, migrations, generated types
│   └── email/            # React Email templates + send logic
├── infra/                # Terraform modules + environments
├── docs/adrs/            # Architecture Decision Records
├── .github/workflows/    # CI/CD pipelines
└── docker-compose.yml    # Local PostgreSQL
```

## Feature folder structure

Each API feature is self-contained:

```
apps/api/src/features/<feature>/
├── routes.ts              # Fastify route handlers (thin — schema, delegate, respond)
├── service.ts             # Business logic (curried factories)
├── schemas.ts             # Zod request + response schemas (drives OpenAPI spec)
├── service.test.ts        # Unit tests (mock DB)
└── integration.test.ts    # Integration tests (testcontainers)
```

## Architecture Principles

### Functional Dependency Injection

No module-level singletons. All dependencies are injected via function parameters.

**Services** are curried factories taking `db: Kysely<DB>` as the first parameter:

```typescript
export function listUsers(db: Kysely<DB>) {
  return async (params: ListUsers) => db.selectFrom("user")...;
}
```

**Tests** pass dependencies directly:

```typescript
const result = await listUsers(ctx.db)({ page: 1, pageSize: 10 });
```

### Config

Environment config is parsed and validated with Zod at startup. Never read `process.env` directly in service or route code — access config through `app.config`.

### Fastify Decorations

The Fastify instance owns all shared dependencies:

- `app.db` — Kysely client (created from config at startup)
- `app.config` — parsed Config object
- `app.auth` — better-auth instance

## Coding Standards

- **All incoming data is Zod-validated via Fastify schema declarations** — declare `schema: { querystring, body, params, response }` on routes using Zod schemas. Fastify validates automatically via `fastify-type-provider-zod`. Do not use `parseBody`/`parseQuery`/`parseParams` — use `request.body`, `request.query`, `request.params` directly (typed by the schema declaration). Never use Fastify's inline generics (`app.get<{ Params: { id: string } }>`) — this is a type assertion, not validation.
- **Every route must have a response schema** — declared in `schemas.ts` and referenced in the route's `schema.response`. After adding/changing response schemas, run `pnpm run openapi:generate`.
- **Frontend API calls use the typed client** — import `{ api, callApi }` from `@/lib/api-client`. Never use raw `fetch` or define local response type interfaces — types are generated from the OpenAPI spec.
- **Use `getAuthSession(request)` for authenticated routes** — imported from `auth/middleware.js`. Returns typed session or throws 401. Never use `request.authSession!` or inline null checks.
- **Use react-query for data fetching in React components** — no raw `fetch` in `useEffect`.
- **Use shadcn/ui components where possible** — compose smaller components into larger ones.
- **Use `NULL` for unset/missing values** — never empty string `""` for "no value".
- **Services take `db: Kysely<DB>` as first parameter** — never import a client singleton.
- **PostgreSQL aggregates return bigint (string in node-pg)** — use `sql<string>` (not `sql<number>`) for all aggregate expressions (`SUM`, `COUNT`, `MAX`, `COALESCE(SUM(...))`, etc.). Wrap in `Number()` when converting. Using `sql<number>` lies to TypeScript and causes `@typescript-eslint/no-unnecessary-type-conversion` to flag the `Number()` call.
- **No `process.env` in services or routes** — use `app.config` via Fastify decoration.
- **Use `return await` in async route handlers** — preserves stack traces for error debugging.

## Generated Files — DO NOT EDIT MANUALLY

| Files                                 | Generator                         | Command                     |
| ------------------------------------- | --------------------------------- | --------------------------- |
| `packages/db/src/__generated__/db.ts` | kysely-codegen (DB schema)        | `pnpm run db:types`         |
| `apps/web/src/lib/api.gen.json`       | @fastify/swagger (OpenAPI spec)   | `pnpm run openapi:generate` |
| `apps/web/src/lib/api.gen.d.ts`       | openapi-typescript (typed client) | `pnpm run openapi:generate` |

## AWS CLI

All AWS CLI commands must use the `percy-main` profile: `aws --profile percy-main ...`. A PreToolUse Bash hook (`.claude/hooks/check-aws-profile.sh`) blocks commands that omit it.

## Architecture Decision Records

When making a non-obvious architectural decision — especially when rejecting a reasonable alternative — record it in [`docs/adrs/`](../docs/adrs/) using the [`add-adr`](./skills/add-adr/SKILL.md) skill.

## Skills for common tasks

| Task                            | Skill                                                    |
| ------------------------------- | -------------------------------------------------------- |
| Add or change an API endpoint   | [`add-endpoint`](./skills/add-endpoint/SKILL.md)         |
| Create a database migration     | [`add-migration`](./skills/add-migration/SKILL.md)       |
| Add a static MDX content page   | [`add-content-page`](./skills/add-content-page/SKILL.md) |
| Write unit or integration tests | [`write-tests`](./skills/write-tests/SKILL.md)           |
| Record an architecture decision | [`add-adr`](./skills/add-adr/SKILL.md)                   |
| Work on GitHub Actions / CI     | [`work-on-ci`](./skills/work-on-ci/SKILL.md)             |
