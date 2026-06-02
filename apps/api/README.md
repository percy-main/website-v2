# apps/api

Fastify backend for the Percy Main club platform. Owns auth, payments, membership, matchday, Scout (AI), and all other domain logic. Serves the OpenAPI spec that the `web` and `matchday` frontends generate their typed clients from.

## Layout

- `src/features/<feature>/` — self-contained feature folders (`routes.ts`, `service.ts`, `schemas.ts`, tests). This is where almost all work happens; see the [`add-endpoint`](../../.claude/skills/add-endpoint/SKILL.md) skill for the pattern.
- `src/lib/` — shared infrastructure wired into the Fastify instance: S3 clients, push notifications, OpenTelemetry, auth helpers.
- `server.ts` / `app.ts` / `config.ts` / `instrumentation.ts` — entry point, app builder, Zod-validated config, and OTel bootstrap (preloaded before `app.ts`).

## Conventions

Architecture principles (functional DI, curried services, Zod-validated schemas, no `process.env` outside config) live in [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) and apply here first. The Fastify instance owns all shared dependencies as decorations (`app.db`, `app.config`, `app.auth`).

After changing a response schema, run `pnpm run openapi:generate` from the repo root so the frontend clients stay in sync.

## Running

- `pnpm dev` — watch mode (tsx), loads env from a local `.env` (see `.env.example`).
- `pnpm test` / `pnpm test:integration` / `pnpm test:all` — unit tests mock the DB; integration tests spin up real PostgreSQL via testcontainers (Docker required). See [`write-tests`](../../.claude/skills/write-tests/SKILL.md).
- Production runs the compiled `dist/` with instrumentation preloaded.

Listens on `0.0.0.0:3000`. Swagger UI is at `/api/docs` in non-production.

## Non-obvious notes

- **Email** defaults to a `dev` provider that writes rendered messages to `.emails/` (previewed by the `email-viewer` app); production uses SES. See [`packages/email`](../../packages/email/README.md).
- **S3** is optional in dev, required in production.
- **Auth** (better-auth) trusts both frontends; sessions are cookie-scoped across the web and matchday subdomains in production.
- **OpenTelemetry** splits spans: AI SDK calls go to Phoenix, everything else to New Relic.
- New env vars in `config.ts` must be **required**, not optional, and threaded into every test fixture.
