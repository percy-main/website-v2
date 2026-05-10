# Percy Main Community Sports Club — v2

Greenfield rewrite of the Percy Main website. pnpm monorepo with a Fastify API, a React + Vite SPA (scaffold only), and Terraform-managed AWS infrastructure.

- Stack: Fastify v5, Kysely, PostgreSQL 16, React + Vite, better-auth, Stripe, React Email + SES, AWS (ECS Fargate, RDS, S3, CloudFront, SES, Route 53).
- Architecture principles and coding standards: see [`.claude/CLAUDE.md`](.claude/CLAUDE.md).
- Architecture decisions: see [`docs/adrs/`](docs/adrs/).

## Local development

Prerequisites: Node.js, pnpm, Docker.

```sh
docker compose up -d          # start PostgreSQL on port 5433
pnpm install                  # install all workspace deps
pnpm run db:up                # apply migrations
pnpm run dev:api              # start API on port 3000
pnpm run dev:web              # start frontend on port 5173 (proxies /api to :3000)
```

Each app/package has its own `.env.example` documenting required environment variables. Copy to `.env` in the same directory and fill in values. Currently only `apps/api/` needs a `.env` file.

Swagger UI for the API is at <http://localhost:3000/api/docs> in non-production environments.

## Workspace layout

```
percy-main/
├── apps/
│   ├── api/              # Fastify API service (backend)
│   └── web/              # React + Vite SPA (frontend)
├── packages/
│   ├── shared/           # Zod schemas, types, constants
│   ├── db/               # Kysely client factory, migrations, generated types
│   └── email/            # React Email templates + send logic
├── infra/                # Terraform modules + environments
├── docs/
│   └── adrs/             # Architecture Decision Records
├── .github/workflows/    # CI/CD pipelines
└── docker-compose.yml    # Local PostgreSQL
```

## Scripts

| Command                              | Description                     |
| ------------------------------------ | ------------------------------- |
| `pnpm run dev`                       | Start all services in parallel  |
| `pnpm run dev:api`                   | Start API only                  |
| `pnpm run dev:web`                   | Start frontend only             |
| `pnpm run build`                     | Build all packages              |
| `pnpm run typecheck`                 | Type-check all packages         |
| `pnpm run lint`                      | Lint all packages               |
| `pnpm run format:check`              | Check Prettier formatting       |
| `pnpm --filter api test`             | Run API unit tests              |
| `pnpm --filter api test:integration` | Run API integration tests       |
| `pnpm --filter api test:all`         | Run both unit + integration     |
| `pnpm run db:up`                     | Run database migrations         |
| `pnpm run db:types`                  | Regenerate DB types             |
| `pnpm run db:migration`              | Create new migration file       |
| `pnpm run openapi:generate`          | Regenerate OpenAPI spec + types |
| `docker compose up -d`               | Start local PostgreSQL          |

## AWS

All AWS CLI commands must use the `percy-main` profile:

```sh
aws --profile percy-main ...
```

Infrastructure is in [`infra/`](infra/). Production DB access for operators is via Tailscale — see [ADR 012](docs/adrs/012-prod-db-access.md).

## Contributing

Development workflow, testing patterns, and common tasks are codified as Claude Code skills under [`.claude/skills/`](.claude/skills/). Humans can follow the same patterns by reading each `SKILL.md`.

### Required PR checks

The following status check is required by branch protection on `main`:

- **`lint-test-build / lint-test-build`** — runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` across all workspaces (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml))

Other checks run on every PR but are advisory only:

- `react-doctor` — React/UI lint and architecture diagnostics
- `unsafe-ddl-check` — flags risky DDL in migrations; bypass with a `safe-ddl-ack:` line in the commit message body when intentional
- `plan (shared)` / `plan (production)` — `terraform plan` against each environment, posted to the PR as a comment
- `CodeQL` / `Analyze (actions)` / `Analyze (javascript-typescript)` — GitHub's static analysis

### Code ownership

Sensitive paths (auth, payments, incident reports, infrastructure, migrations, ADRs) are routed via [`.github/CODEOWNERS`](.github/CODEOWNERS). PRs touching these paths auto-request review from the listed owner.

### Dependency updates

Dependabot opens grouped weekly version-update PRs (Mondays 06:00 Europe/London) for npm, GitHub Actions, Docker base images, and Terraform providers — see [`.github/dependabot.yml`](.github/dependabot.yml). Security updates land regardless of this config.

### Reporting security issues

See [`SECURITY.md`](SECURITY.md) — please do not file public GitHub issues for vulnerabilities.
