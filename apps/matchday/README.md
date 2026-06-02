# apps/matchday

Offline-capable PWA for match-day workflows: captain team sheets, availability, player payments/charges, donations, and expenses. A separate, leaner frontend from `web` — no public/marketing routes, every route requires auth.

## Layout

- `src/pages/` — route components (availability, fixtures, the matchday edit/live/wrap flow, donations, expenses, official tools), lazy-loaded.
- `src/features/` — domain logic grouped by area (charges, donations, memberships, notifications, games).
- `src/components/`, `src/providers/`, `src/hooks/` — app shell, context, custom hooks.
- `src/lib/` — typed API client, auth client, helpers.

## Conventions

Same frontend standards as [`apps/web`](../web/README.md): typed API client from the OpenAPI spec (never raw `fetch`), react-query, shadcn/ui, URL-persisted UI state. See [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md).

## Running

- `pnpm dev` — Vite on port 5175, proxies `/api/*` to the API on `:3000`.
- `pnpm build` — type-checks then builds.

## Non-obvious notes

- **PWA-first** (VitePWA + Workbox): installable, app shortcuts, custom push handler. Updates are **prompt-to-reload**, not silent auto-update.
- **Offline strategy**: reads use StaleWhileRevalidate; writes (mark-paid, expenses, availability responses) use NetworkOnly with background-sync queues so they replay when connectivity returns.
- The React Compiler is enabled (Babel preset).
- In production this is served under its own subdomain and shares the better-auth session cookie with `web`. (Its CDN/DNS lives outside the main Route 53 zone — see [`infra`](../../infra/README.md).)
