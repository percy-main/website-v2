# Migration Status

Tracking progress of the AWS migration from v1 (Astro/Netlify/SQLite) to v2 (React/AWS/PostgreSQL).

This repo will replace the existing v1 repo, which is in `@../website`

See [implementation-plan.md](./aws/implementation-plan.md) for the full plan.

---

## Phase 1: AWS Foundation & Database — COMPLETE

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

### AWS infrastructure

- [x] VPC configuration (public + private subnets)
- [x] Route 53 DNS for percymain.org (nameservers delegated from GoDaddy)
- [x] SES domain verification (SPF/DKIM/DMARC) via `contact.percymain.org`
- [x] S3 buckets (frontend assets + user uploads)
- [x] RDS PostgreSQL provisioning (db.t4g.micro, single-AZ)
- [x] Data migration tool — `scripts/bastion-tunnel.sh` + `pnpm run db:lift` (Turso → RDS)
- [x] Data synced: 21,454 rows across 27 tables

---

## Phase 2: Backend Service — COMPLETE

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

### AWS infrastructure

- [x] ECR repository (immutable tags, scan on push, 25-image retention)
- [x] ECS Fargate cluster + service (1 task, auto-scales to 4)
- [x] ALB + target group + health checks
- [x] CloudWatch log groups (30-day retention)
- [x] CloudWatch alarms (CPU, memory, 5xx, unhealthy hosts, latency, RDS)
- [x] EventBridge scheduled tasks (Play-Cricket sync Sun/Fri 3am)

---

## Phase 3: Data Pipelines — DEFERRED

**Goal:** Decouple external data ingestion into independent ETL stages.

Deferred post-migration. EventBridge → ECS run-task is sufficient for now.

- [ ] Separate Play-Cricket sync into independent pipeline stages
- [ ] Fantasy scoring pipeline (triggered after ingest)
- [ ] Fantasy reminder scheduled job (Thursday email to inactive teams)
- [ ] Cache refresh for league tables and leaderboards
- [ ] CloudWatch metrics per pipeline stage
- [ ] Make each stage idempotent and resumable

---

## Phase 4: Frontend Migration — COMPLETE

**Goal:** Migrate from Astro to React + Vite SPA on S3 + CloudFront.

- [x] `apps/web` scaffold (React + Vite + React Router + Tailwind v4 + React Query)
- [x] Vite dev proxy (`/api` → localhost:3000)
- [x] React Router route definitions
- [x] Root providers (auth context, React Query)
- [x] Port non-Contentful pages (Batch 2):
  - [x] Cricket leaderboard
  - [x] Fantasy cricket (3 pages: home with tabs, scoring rules, team management + 20 new API endpoints). Deferred items:
    - [x] Recharts season timeline chart on history tab
    - Chaos week admin email sending — deferred, not in scope for migration
    - [x] Team share image generation
    - [x] Fix flaky fantasy integration tests on CI (`startTestContainer()` exceeds 30s timeout on GitHub Actions — currently skipped, passes locally)
    - **Note:** Fantasy team builder cannot be fully tested until admin side of fantasy is completed (player population, cost calculation, eligibility toggling)
  - [x] Be the Keeper game (2 pages)
  - [x] Static pages (privacy policy, nets redirect, payment confirmation)
  - [x] Admin panel (all 11 tabs: Members, Sponsorships, Treasurer, Fantasy, Record Linking, Juniors, Charges, Contacts, Duplicates, Match Fees, Game Reports)
  - [x] Official panel
  - [x] Junior manager panel
- [x] Port Contentful-dependent pages (Batch 3): news, calendar, person profiles, CMS pages, game reports
- [x] Replace Astro actions with API calls (api client + react-query pattern established)
- [x] CloudFront distribution + S3 origin
- [x] SPA routing (CloudFront Function rewrite to index.html)
- [ ] Deploy preview infrastructure (per-PR S3 prefixes) — deferred, not needed

---

## Phase 5: Content Migration — COMPLETE

**Goal:** Remove Contentful, inline content as MDX.

- [x] MDX content infrastructure (Vite import.meta.glob, file-based routing, MDX components)
- [x] Pages migrated from Contentful `page` → `content/pages/**/*.mdx`
- [x] News migrated from Contentful `news` → `content/news/**/*.mdx`
- [x] Events migrated from Contentful `event` → `content/events/*.mdx`
- [x] People migrated from Contentful `trustee` → `content/people/*.mdx`
- [x] Game reports migrated from Contentful `gameDetail` → `content/games/*.mdx` (9 reports)
- [x] Calendar pages (`/calendar`, `/calendar/:year/:month`) — games from Play Cricket API + events from MDX
- [x] Game detail page (`/calendar/game/:id`) — scorecard, result, MDX report, sponsor, map
- [x] MDX components: LeagueTable, ContactForm, EventPreview, GamePreview, Person, PersonGrid, Image
- [x] Preserve URL slugs/routes
- [ ] Image assets → S3 (currently using original URLs)
- [x] Remove Contentful dependencies — no longer needed in v2

---

## Phase 6: Cutover & Environments — COMPLETE

**Goal:** DNS cutover, decommission old services.

- [x] DNS cutover — nameservers moved from Netlify to Route 53
- [x] Canonical domain: `www.percymain.org` (apex 301 redirects to www)
- [x] API: `api.v2.percymain.org`
- [x] CloudFront Function redirects (apex → www, kit → VX-3)
- [x] All DNS records migrated (MX, SPF, DKIM, DMARC, Google verification)
- [x] Stripe webhook configured for v2 API
- [x] Auth secrets aligned (BETTER_AUTH_SECRET, RP_ID match v1)
- [x] Data synced from Turso → RDS (21,454 rows)
- [x] Google OAuth already configured for percymain.org
- [x] End-to-end verification (Lighthouse: 100/95/100/91)
- [x] v1 Netlify downgraded to free plan, kept as fallback
- [ ] Decommission Netlify (archive v1 repo)
- [ ] Decommission Turso
- [ ] Decommission Mailgun — verify SES emails working first
- [ ] Decommission Contentful — no longer needed

---

## Infrastructure as Code — COMPLETE

- [x] Terraform modules (vpc, rds, ecs-service, cdn, monitoring, dns, scheduling)
- [x] Environment configs (shared, production)
- [x] S3 backend + DynamoDB lock table for Terraform state
- [x] OIDC identity provider for GitHub Actions
- [x] CI/CD pipelines (CI, deploy-api, deploy-web, terraform plan/apply)
- [x] GitHub Actions workflows fully operational

---

## Cross-cutting

- [x] `.claude/CLAUDE.md` — project guide for v2
- [x] `.claude/skills/` — triage, clarify, devit
- [x] `docs/adrs/` — 11 Architecture Decision Records
- [x] `docs/` — admin guides, member guides, Play-Cricket API reference, AWS plan
- [x] `packages/shared` — Zod schemas, member categories, payment metadata
- [x] `packages/email` — 9 templates + SES sender + dev file writer
- [x] Port full email template content from v1
- [x] ESLint + Prettier config for monorepo

### Remaining work (non-blocking)

- [ ] Verify SES emails working in production (test password reset, email verification flows)
- [ ] Image assets → S3 (currently using original URLs from Contentful/v1)
- [ ] API type safety (ADR 011): shared Zod response schemas, OpenAPI generation, typed frontend client
- [ ] Deploy preview infrastructure (per-PR S3 prefixes) — nice to have
- [ ] WAF configuration — nice to have
- [ ] Stripe → EventBridge (replace webhook endpoint) — future improvement
