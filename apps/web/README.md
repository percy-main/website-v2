# apps/web

The public and member-facing Percy Main website — a React 19 + Vite SPA. Public content (news, calendar, people, leaderboard, fantasy, sponsorship checkout) plus authenticated member areas (account, payments, game detail).

## Layout

- `src/pages/` — route components, lazy-loaded per route via React Router.
- `src/components/` — reusable UI; compose shadcn/ui primitives into larger pieces.
- `src/layouts/`, `src/providers/`, `src/hooks/` — app shell, context, custom hooks.
- `src/lib/` — the typed API client, auth client, content/markdown loading, and other cross-cutting helpers.

## Conventions

Frontend coding standards (typed API client only, react-query for data, shadcn/ui, URL-persisted UI state) are in [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md).

API response types are **generated from the API's OpenAPI spec** — never hand-write response interfaces or use raw `fetch`. Import `{ api, callApi }` from `@/lib/api-client`. Regenerate with `pnpm run openapi:generate` (repo root) after API schema changes.

## Running

- `pnpm dev` — Vite on port 5173, proxies `/api/*` to the API on `:3000` (run the API alongside).
- `pnpm build` — type-checks then builds; `pnpm preview` serves the build.

## Non-obvious notes

- The React Compiler is enabled (Babel preset) — follow the rules of hooks; no manual memoization needed.
- MDX with frontmatter powers article/content pages; see the [`add-content-page`](../../.claude/skills/add-content-page/SKILL.md) skill.
- Responsive images go through `vite-imagetools` (srcset / `<picture>`).
- The Google Analytics snippet is stripped from the built HTML when no GA4 ID is configured.
- New Relic browser agent and Stripe are optional in dev.
