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

**Routes** wire up services at registration time:

```typescript
export const adminRoutes: FastifyPluginAsync = async (app) => {
  const list = listUsers(app.db);
  app.get("/admin/users", async (req) => list(parseQuery(req, schema)));
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

| Files                                 | Generator                  | Command             |
| ------------------------------------- | -------------------------- | ------------------- |
| `packages/db/src/__generated__/db.ts` | kysely-codegen (DB schema) | `pnpm run db:types` |

After creating a new migration, run:

```sh
docker compose up -d                    # start local PostgreSQL
pnpm run db:up                         # apply migrations
pnpm run db:types                      # regenerate types
```

The generator introspects the schema from the running PostgreSQL database.

## Coding Standards

- **All incoming data is Zod-validated** — body (`parseBody`), query (`parseQuery`), and route params (`parseParams`). Never use Fastify's inline generics (`app.get<{ Params: { id: string } }>`) to type request data — this is a type assertion, not validation. Untrusted input must always pass through a Zod schema.
- **Never type-assert API responses** — validate with zod schemas (`schema.parse(...)`) not `as SomeType`
- **Use `getAuthSession(request)` for authenticated routes** — imported from `auth/middleware.js`. Returns typed session or throws 401. Never use `request.authSession!` or inline null checks.
- **Use react-query for data fetching in React components** — no raw `fetch` in `useEffect`
- **Use shadcn/ui components where possible** — compose smaller components into larger ones
- **Use `NULL` for unset/missing values** — never empty string `""` for "no value"
- **Services take `db: Kysely<DB>` as first parameter** — never import a client singleton
- **PostgreSQL aggregates return bigint (string in node-pg)** — use `sql<string>` (not `sql<number>`) for all aggregate expressions (`SUM`, `COUNT`, `MAX`, `COALESCE(SUM(...))`, etc.) so the type honestly reflects what node-pg returns. Then wrap in `Number()` when converting to a JS number. Using `sql<number>` lies to TypeScript and causes the lint rule `@typescript-eslint/no-unnecessary-type-conversion` to flag the `Number()` call as redundant.
- **No `process.env` in services or routes** — use `app.config` via Fastify decoration
- **Use `return await` in async route handlers** — preserves stack traces for error debugging
- **Always add imports and their usage in the same edit** — lint hooks run on save and will strip unused imports. Never add an import in one edit and its usage in a separate edit.

## Feature Folder Structure

Each API feature is self-contained:

```
apps/api/src/features/<feature>/
├── routes.ts              # Fastify route handlers (thin — parse, delegate, respond)
├── service.ts             # Business logic (curried factories, testable without HTTP)
├── schemas.ts             # Zod validation schemas
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

When beginning work on a ticket:

1. **Read the ticket** — GitHub issues are the source of truth. Read body + comments.

2. **Create a feature branch and worktree** — branch from `main`, include ticket number (e.g. `18-add-user-profile`). Use `@.worktrees/` for worktree location.

3. **Analyse current behaviour** — understand existing code before changing it.

4. **Clarify with the user** — make pragmatic decisions for ambiguities, note assumptions.

5. **Build a plan** — identify files to create/modify, break into steps, consider tests.

6. **Execute** — commit frequently, ensure lint + test + typecheck pass locally.

7. **Pre-PR verification** — before opening a PR, run the full CI check suite locally: `pnpm run typecheck && pnpm run lint && pnpm format:check && pnpm --filter api test`. Fix any issues before proceeding.

8. **Open a PR** — against `main`, include `Closes #N`.

9. **Review** — use a code-reviewer agent. Instruct it to read files locally (not via WebFetch). Post comments on the PR.

10. **Address review comments** — commit fixes, reply to each comment.

11. **Finalise** — ensure all CI checks pass and review comments are addressed.

12. **Clean up** — stop local processes, delete worktree.

13. **Report** — notify user with summary and PR link.

## Key Scripts

| Command                              | Description                    |
| ------------------------------------ | ------------------------------ |
| `pnpm run dev`                       | Start all services in parallel |
| `pnpm run dev:api`                   | Start API only                 |
| `pnpm run dev:web`                   | Start frontend only            |
| `pnpm run build`                     | Build all packages             |
| `pnpm run typecheck`                 | Type-check all packages        |
| `pnpm run lint`                      | Lint all packages              |
| `pnpm --filter api test`             | Run API unit tests             |
| `pnpm --filter api test:integration` | Run API integration tests      |
| `pnpm run db:up`                     | Run database migrations        |
| `pnpm run db:types`                  | Regenerate DB types            |
| `pnpm run db:migration`              | Create new migration file      |
| `docker compose up -d`               | Start local PostgreSQL         |

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
