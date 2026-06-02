# @percy-main/shared

The cross-cutting domain vocabulary: Zod schemas, enums/constants, and the auth permission model shared by the API and both frontends. No code generation — these hand-written schemas are the source of truth that the rest of the monorepo derives types from.

## What's here

- **Domain schemas & enums** — member categories, age groups, payment metadata, financial relief, Scout content, Stripe config, and similar. Schema-first: define the Zod schema / enum here, import it everywhere.
- **`src/auth/permissions.ts`** — role-based access control built on better-auth's access-control plugin. Roles are statement sets (resource → actions), checked locally with no network call.
- **`src/marketing/`** — marketing domain (campaigns, leads, consent, attribution, events).

## Imports

Subpath exports are deliberately separate — they are **not** re-exported from the root:

- `@percy-main/shared` — core domain schemas/enums.
- `@percy-main/shared/marketing` — marketing schemas.
- `@percy-main/shared/auth/permissions` — the permission system.

## Non-obvious notes

- Some roles are club-wide while others are scoped via join tables (`SCOPED_ROLES`) — check which kind you're dealing with before assuming a role applies globally.
- Because everything downstream depends on these types, prefer additive changes; a schema change here ripples into the API, both frontends, and the generated OpenAPI client.
