# Migration Status

Tracking progress of the AWS migration from v1 (Astro/Netlify/SQLite) to v2 (React/AWS/PostgreSQL).

This repo will replace the existing v1 repo, which is in `@../website`

See [implementation-plan.md](./aws/implementation-plan.md) for the full plan.

---

## Phase 1: AWS Foundation & Database

**Goal:** AWS account setup, database migration from SQLite to PostgreSQL.

### In-repo work

- [x] Monorepo scaffold (pnpm workspaces, `apps/` + `packages/` + `infra/`)
- [x] `packages/db` — Kysely with `PostgresDialect` (ported from `LibsqlDialect`)
- [x] Consolidated baseline migration (47 SQLite migrations → 1 PostgreSQL migration)
- [x] Integer booleans → native PostgreSQL `boolean`
- [x] `autoIncrement` → `serial`
- [x] Auth config `type: "sqlite"` → `type: "postgres"`
- [x] Generated types from `kysely-codegen` against live PostgreSQL
- [x] DB service functions ported (`updateMembership`, `createPaymentCharge`, `createJuniorMemberships`)
- [x] Docker Compose for local PostgreSQL development
- [x] DB client is a pure factory (`createClient(connectionString)`) — no singleton

### AWS infrastructure (not yet started)

- [ ] AWS Organization setup (production + staging accounts)
- [ ] CloudTrail enabled
- [ ] VPC configuration (public + private subnets)
- [ ] NAT Gateway
- [ ] Route 53 DNS for percymain.org
- [ ] SES domain verification (SPF/DKIM/DMARC)
- [ ] S3 buckets (frontend assets + user uploads)
- [ ] RDS PostgreSQL provisioning (db.t4g.micro, single-AZ)
- [ ] Data migration tool (Turso → RDS scripted export/transform/import)

---

## Phase 2: Backend Service

**Goal:** Standalone API service on ECS Fargate replacing Astro actions.

### In-repo work

- [x] `apps/api` — Fastify v5 API service
- [x] All 21 Astro action handlers ported to 14 feature modules (67 routes)
- [x] Feature folder structure (`routes.ts`, `service.ts`, `schemas.ts`, tests)
- [x] Functional DI — services are curried factories `(db: Kysely<DB>) => (params) => result`
- [x] Zod config parsing (`parseConfig(env)`) — no `process.env` in services
- [x] Fastify decorations (`app.db`, `app.config`, `app.auth`)
- [x] Auth middleware ported (better-auth, passkeys, 2FA, Google OAuth)
- [x] Stripe webhook handler ported (raw body parsing, ts-pattern routing)
- [x] Dockerfile (multi-stage, ARM-ready for Graviton)
- [x] 78 unit tests + 69 integration tests (testcontainers), all passing
- [x] Port full Stripe webhook handler logic (checkout, invoice, payment_intent)
- [x] Port Play-Cricket background sync job
- [x] Port fantasy score calculation pipeline

### AWS infrastructure (not yet started)

- [ ] ECR repository
- [ ] ECS Fargate cluster + service (2 tasks production)
- [ ] ALB + target group + health checks
- [ ] CloudWatch log groups
- [ ] Initial CloudWatch alarms (error rates, health check failures)
- [ ] EventBridge scheduled tasks (Play-Cricket sync, fantasy reminders)

---

## Phase 3: Data Pipelines

**Goal:** Decouple external data ingestion into independent ETL stages.

- [ ] Separate Play-Cricket sync into independent pipeline stages
- [ ] Fantasy scoring pipeline (triggered after ingest)
- [ ] Fantasy reminder scheduled job (Thursday email to inactive teams — replaces Netlify cron)
- [ ] Cache refresh for league tables and leaderboards
- [ ] EventBridge scheduling
- [ ] CloudWatch metrics per pipeline stage
- [ ] Make each stage idempotent and resumable

---

## Phase 4: Frontend Migration

**Goal:** Migrate from Astro to React + Vite SPA on S3 + CloudFront.

- [x] `apps/web` scaffold (React + Vite + React Router + Tailwind v4 + React Query)
- [x] Vite dev proxy (`/api` → localhost:3000)
- [x] React Router route definitions
- [x] Root providers (auth context, React Query)
- [ ] Port non-Contentful pages (Batch 2):
  - [x] Cricket leaderboard
  - [x] Fantasy cricket (3 pages: home with tabs, scoring rules, team management + 20 new API endpoints). Deferred items:
    - [ ] Recharts season timeline chart on history tab (hooks wired, chart rendering TODO)
    - [ ] Chaos week admin email sending (needs `packages/email` ChaosWeekAnnouncement template wiring)
    - [ ] Team share image generation (depends on Contentful player photos — deferred to Phase 5)
    - **Note:** Fantasy team builder cannot be fully tested until admin side of fantasy is completed (player population, cost calculation, eligibility toggling)
  - [x] Be the Keeper game (2 pages)
  - [x] Static pages (privacy policy, nets redirect, payment confirmation)
  - [x] Admin panel (5 of 11 tabs: Members, Sponsorships, Treasurer, Fantasy, Record Linking). Deferred tabs:
    - [ ] Juniors tab (needs admin junior listing API)
    - [ ] Charges tab (needs admin charge listing/aggregates API)
    - [ ] Contacts tab (needs contact submission listing API)
    - [ ] Duplicates tab (needs find/merge duplicates API)
    - [ ] Match Fees tab (needs match fee rates CRUD API)
    - [ ] Game Reports tab (needs matchday report aggregation API)
  - [x] Official panel
  - [x] Junior manager panel
- [ ] Port Contentful-dependent pages (Batch 3 — deferred to cutover: news, calendar, person profiles, CMS pages)
- [x] Replace Astro actions with API calls (api client + react-query pattern established)
- [ ] CloudFront distribution + S3 origin
- [ ] SPA routing (custom error response → index.html)
- [ ] Deploy preview infrastructure (per-PR S3 prefixes)

---

## Phase 5: Content Migration

**Goal:** Remove Contentful, inline content as React components.

- [ ] Inline pages, news, events, people/trustees as React components
- [ ] Image assets → S3
- [ ] Remove Contentful dependencies
- [ ] Preserve URL slugs/routes

---

## Phase 6: Cutover & Environments

**Goal:** Staging environment, DNS cutover, decommission old services.

- [ ] Staging environment (VPC, ECS, ALB, RDS, S3, CloudFront, CloudWatch)
- [ ] Deploy preview infrastructure (per-PR PostgreSQL schemas + S3 prefixes)
- [ ] WAF configuration
- [ ] DNS cutover (lower TTL, switch, parallel run)
- [ ] Update Stripe webhook URLs
- [ ] End-to-end verification
- [ ] Decommission Netlify, Turso, Mailgun, Contentful

---

## Infrastructure as Code

- [x] Terraform module stubs (vpc, rds, ecs-service, cdn, monitoring, dns)
- [x] Environment configs (shared, production, staging)
- [x] GitHub Actions workflow stubs (CI, deploy-api, deploy-web, terraform)
- [ ] Implement Terraform modules (actual resource definitions)
- [ ] S3 backend + DynamoDB lock table for Terraform state
- [ ] OIDC identity provider for GitHub Actions
- [ ] CI/CD pipeline implementation

---

## Cross-cutting

- [x] `.claude/CLAUDE.md` — project guide for v2
- [x] `.claude/skills/` — triage, clarify, devit
- [x] `docs/adrs/` — 11 Architecture Decision Records
- [x] `docs/` — admin guides, member guides, Play-Cricket API reference, AWS plan
- [x] `packages/shared` — Zod schemas, member categories, payment metadata
- [x] `packages/email` — 9 template stubs + SES sender + dev file writer
- [x] Port full email template content from v1
- [x] ESLint + Prettier config for monorepo

### API type safety (ADR 011)

- [ ] Shared Zod response schemas in `packages/shared/src/api/` (Phase 1 — adopt for new endpoints, backfill existing)
- [ ] Wire up `fastify-type-provider-zod` + `@fastify/swagger` for OpenAPI generation (Phase 2)
- [ ] Generate typed frontend client from OpenAPI spec via `openapi-typescript` + `openapi-fetch` (Phase 2)
