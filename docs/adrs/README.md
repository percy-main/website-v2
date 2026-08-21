# Architecture Decision Records

Records of non-obvious architectural decisions for the Percy Main v2 monorepo. Each ADR captures the decision, problem, options considered, rationale, and rejected alternatives so a future contributor can understand _why_ the code looks the way it does.

To add a new ADR, use the [`add-adr` skill](../../.claude/skills/add-adr/SKILL.md).

## Index

| #                                                        | Title                                                              | Date       | Status   |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ---------- | -------- |
| [001](001-api-framework.md)                              | API Framework - Fastify over Express                               | 2026-03-14 | Accepted |
| [002](002-email-provider.md)                             | Email Provider - SES over Mailgun                                  | 2026-03-14 | Accepted |
| [003](003-baseline-migration-strategy.md)                | Baseline Migration Strategy - Single Consolidated Migration        | 2026-03-14 | Accepted |
| [004](004-auth-database-type.md)                         | better-auth Database Type - postgres                               | 2026-03-14 | Accepted |
| [005](005-generated-types-approach.md)                   | Generated DB Types - Placeholder with PostgreSQL Types             | 2026-03-14 | Accepted |
| [006](006-monorepo-structure.md)                         | Monorepo Structure - Following the Plan                            | 2026-03-14 | Accepted |
| [007](007-webhook-raw-body.md)                           | Stripe Webhook Raw Body Handling                                   | 2026-03-14 | Accepted |
| [008](008-vite-proxy-for-local-dev.md)                   | Vite Dev Server Proxy for Local Development                        | 2026-03-14 | Accepted |
| [009](009-dependency-injection.md)                       | Functional Dependency Injection                                    | 2026-03-14 | Accepted |
| [010](010-testcontainers.md)                             | Testcontainers for Integration Tests                               | 2026-03-14 | Accepted |
| [011](011-api-type-safety.md)                            | API Type Safety Between Backend and Frontend                       | 2026-03-16 | Accepted |
| [012](012-prod-db-access.md)                             | Production DB Access via Tailscale                                 | 2026-04-20 | Accepted |
| [042](042-scout-recognition-sources.md)                  | Scout Recognition Sources - Public-Source Discovery                | 2026-05-14 | Accepted |
| [043](043-db-role-split-principle-of-least-privilege.md) | DB Role Split - Principle of Least Privilege                       | 2026-05-15 | Accepted |
| [044](044-matchday-notification-channel-modelling.md)    | Matchday notification channel modelling                            | 2026-05-21 | Accepted |
| [045](045-matchday-service-worker-push-integration.md)   | Matchday service worker push integration via importScripts         | 2026-05-21 | Accepted |
| [046](046-vapid-public-key-via-api.md)                   | VAPID public key delivered via API, not bundled                    | 2026-05-21 | Accepted |
| [047](047-content-editor-blocknote.md)                   | Content Editor - BlockNote with JSON canonical format              | 2026-06-10 | Accepted |
| [048](048-editor-image-webp-only-sync-processing.md)     | Editor images - WebP-only ladder, synchronous processing           | 2026-06-10 | Accepted |
| [049](049-ai-content-author-assistant.md)                | AI content-author assistant reuses Scout's tools                   | 2026-06-14 | Accepted |
| [050](050-profile-self-edit-proposal-tier.md)            | Profile self-editing via a proposal/approval tier                  | 2026-06-23 | Accepted |
| [051](051-member-slug-backfill-and-profile-fallback.md)  | Member slug backfill, member-backed profile fallback, self-create  | 2026-06-24 | Accepted |
| [052](052-publish-time-prerendering.md)                  | Publish-time prerendering via Lambda + CloudFront KeyValueStore    | 2026-07-03 | Accepted |
| [053](053-prerendering-fixtures-and-calendar.md)         | Prerendering fixtures and calendar months via hash-diffed manifest | 2026-07-04 | Accepted |
| [054](054-typescript-7-native-with-v6-api-alias.md)      | TypeScript 7 native compiler, v6 JS API aliased for tooling        | 2026-07-08 | Accepted |
| [055](055-content-assistant-edit-ops-and-sidebar.md)     | Content assistant edit-op protocol + persistent sidebar            | 2026-07-09 | Accepted |
| [056](056-dnb-rows-stay-in-batting-table.md)             | "Did not bat" rows stay in the batting table with a did_bat flag   | 2026-07-26 | Accepted |
| [057](057-reviewer-gated-terraform-pr-plans.md)          | Reviewer-gated Terraform PR plans instead of a de-scoped plan role | 2026-08-20 | Accepted |
| [060](060-fantasy-player-id-change-alerting.md)          | Alert on Play Cricket player ID changes, reconcile by hand         | 2026-08-21 | Accepted |
