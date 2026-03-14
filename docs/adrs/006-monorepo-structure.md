# Decision 006: Monorepo Structure — Following the Plan

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Follow the monorepo structure defined in `docs/aws/monorepo.md` exactly:

```
percy-main/
├── apps/web/          # React + Vite SPA
├── apps/api/          # Fastify API service
├── packages/shared/   # Zod schemas, types, constants
├── packages/db/       # Kysely client, migrations, services
├── packages/email/    # React Email templates + send logic
├── infra/             # Terraform modules + environments
└── .github/workflows/ # CI/CD pipelines
```

## Deviation from plan

The plan mentions `packages/shared` containing "Shared types, constants, validation schemas (Zod)". I've kept it focused on truly shared code — schemas and types used by both `apps/web` and `apps/api`. Domain-specific logic stays in its respective app.

## What's NOT in packages/shared

- Auth logic (stays in `apps/api/src/lib/auth.ts` — only the API needs server-side auth)
- Stripe integration (stays in `apps/api/src/lib/stripe.ts`)
- Contentful types (will be removed entirely in Phase 5)

The plan's principle of extracting only what's genuinely shared by multiple consumers is respected.
