---
name: Migrate not rewrite - match v1 implementation closely
description: Endpoints and features should be ported very similarly to v1, not guessed/rewritten from scratch
type: feedback
---

Endpoints should be implemented very similarly to v1 actions in 99% of cases. Stop doing guessed rewrites of code — we are MIGRATING, not REWRITING.

**Why:** The v1 code is the source of truth. Guessing at implementation details leads to bugs, missing features, and wasted review cycles. The v1 patterns work and have been tested in production.

**How to apply:** Always read the v1 implementation first and port it faithfully to v2 patterns (Fastify routes, Kysely queries, curried DI). Only change what's necessary for the v2 tech stack (SQLite→PostgreSQL, Astro actions→Fastify routes, singletons→DI). When unsure, default to matching v1 exactly.
