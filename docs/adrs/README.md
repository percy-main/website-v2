# Architecture Decision Records

Records of non-obvious architectural decisions for the Percy Main v2 monorepo. Each ADR captures the decision, problem, options considered, rationale, and rejected alternatives so a future contributor can understand _why_ the code looks the way it does.

To add a new ADR, use the [`add-adr` skill](../../.claude/skills/add-adr/SKILL.md).

## Index

| #                                                        | Title                                                       | Date       | Status   |
| -------------------------------------------------------- | ----------------------------------------------------------- | ---------- | -------- |
| [001](001-api-framework.md)                              | API Framework - Fastify over Express                        | 2026-03-14 | Accepted |
| [002](002-email-provider.md)                             | Email Provider - SES over Mailgun                           | 2026-03-14 | Accepted |
| [003](003-baseline-migration-strategy.md)                | Baseline Migration Strategy - Single Consolidated Migration | 2026-03-14 | Accepted |
| [004](004-auth-database-type.md)                         | better-auth Database Type - postgres                        | 2026-03-14 | Accepted |
| [005](005-generated-types-approach.md)                   | Generated DB Types - Placeholder with PostgreSQL Types      | 2026-03-14 | Accepted |
| [006](006-monorepo-structure.md)                         | Monorepo Structure - Following the Plan                     | 2026-03-14 | Accepted |
| [007](007-webhook-raw-body.md)                           | Stripe Webhook Raw Body Handling                            | 2026-03-14 | Accepted |
| [008](008-vite-proxy-for-local-dev.md)                   | Vite Dev Server Proxy for Local Development                 | 2026-03-14 | Accepted |
| [009](009-dependency-injection.md)                       | Functional Dependency Injection                             | 2026-03-14 | Accepted |
| [010](010-testcontainers.md)                             | Testcontainers for Integration Tests                        | 2026-03-14 | Accepted |
| [011](011-api-type-safety.md)                            | API Type Safety Between Backend and Frontend                | 2026-03-16 | Accepted |
| [012](012-prod-db-access.md)                             | Production DB Access via Tailscale                          | 2026-04-20 | Accepted |
| [042](042-scout-recognition-sources.md)                  | Scout Recognition Sources - Public-Source Discovery         | 2026-05-14 | Accepted |
| [043](043-db-role-split-principle-of-least-privilege.md) | DB Role Split - Principle of Least Privilege                | 2026-05-15 | Accepted |
