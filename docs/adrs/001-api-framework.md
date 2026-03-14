# Decision 001: API Framework — Fastify over Express

**Date:** 2026-03-14
**Status:** Accepted

## Decision

Use **Fastify** as the API framework for `apps/api`.

## Options Considered

### Fastify (chosen)

- First-class TypeScript support with typed plugins and hooks
- Built-in schema validation (integrates well with Zod via plugins)
- Async-first design — no callback patterns
- Plugin system with encapsulated contexts (similar to how we use Astro's action groups)
- Faster than Express in benchmarks (though irrelevant at our traffic levels)
- Fastify v5 is stable and actively maintained

### Express

- Larger ecosystem and more tutorials
- More familiar to most Node.js developers
- Simpler middleware model
- Would work fine for our needs

### Hono

- Ultra-lightweight, web-standard Request/Response
- Good for edge/serverless but we're running persistent ECS tasks
- Smaller ecosystem

## Rationale

The existing codebase already uses typed, validated patterns throughout (Zod schemas on every action, TypeScript strict mode). Fastify's plugin system and typed hooks are a natural fit for organising the API into domain-scoped route groups, mirroring how actions are currently grouped in the Astro codebase. Express would work but would require more boilerplate to achieve the same level of type safety.

The traffic volume (~200 members, few hundred requests/day) means performance differences are irrelevant — this is a developer experience decision.
