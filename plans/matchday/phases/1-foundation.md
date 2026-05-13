# Phase 1 — Foundation

**Goal.** `matchday.percymain.org` is live in production, serves a signed-in user a placeholder home page, and proves cross-subdomain auth works end-to-end.

**Everything else hangs off this.** Ship this first, flush out Safari ITP problems _before_ investing in feature work.

## Deliverables

### App scaffold

- `apps/matchday/` pnpm workspace package
  - `package.json` — `@percy-main/matchday`, private, same React/Vite/Tailwind versions as `apps/web`
  - `vite.config.ts` — Vite + `vite-plugin-pwa` (minimal config — register service worker, no offline caching yet, that's phase 5)
  - `tsconfig.json` extending repo base
  - `eslint.config.ts` and `prettier` inherited
  - Entry `src/main.tsx`, root `src/app.tsx`, router `src/router.tsx`
  - Dev port `5174` (API on `3000`, main web on `5173`)
- `apps/matchday/index.html` with PWA manifest link and theme colour
- Copy shadcn base components from `apps/web/src/components/ui/` into `apps/matchday/src/components/ui/` — same versions so divergence is a choice, not an accident
- Tailwind config — same tokens as main site initially; document where matchday-specific tokens go
- Typed API client — regenerate `api.gen.json` / `api.gen.d.ts` at `apps/matchday/src/lib/api.gen.*` (or share from `apps/web` via a tsconfig path — simpler, but couples builds; prefer a regenerate step in `openapi:generate`)

### Auth — cross-subdomain

Server (`apps/api/src/features/auth/auth.ts`):

- Add `advanced.crossSubDomainCookies = { enabled: true, domain: ".percymain.org" }` (dev: `".localhost"`)
- Add `advanced.useSecureCookies: isProduction`
- Expand `trustedOrigins` to include the three prod origins + `DEPLOY_PRIME_URL`
- `BETTER_AUTH_RP_ID` env var set to `percymain.org` in prod; `.localhost` in dev

Server (`apps/api/src/app.ts`):

- Expand `cors.origin` from single string to array: `[BASE_URL, MATCHDAY_URL, WWW_URL, DEPLOY_PRIME_URL].filter(Boolean)` — sourced from config

Client (`apps/matchday/src/lib/auth-client.ts`):

- `createAuthClient({ baseURL: env.VITE_API_URL, fetchOptions: { credentials: "include" } })` with `adminClient`, `passkeyClient`, `twoFactorClient` plugins (match main site)

Login redirect component:

- `apps/matchday/src/components/require-auth.tsx` — wraps the router; on no session, `window.location.href = https://percymain.org/login?redirect=${encodeURIComponent(window.location.href)}`
- In `apps/web` (main site) login page: after successful login, if `?redirect=` is present _and_ parses to a URL on `.percymain.org`, `window.location.href = redirect`. ~20 LOC change to main site.

### Infrastructure

Terraform (`infra/modules/cdn/` extensions and `infra/environments/production/main.tf`):

- New S3 bucket `percy-main-${env}-matchday` with OAC
- New CloudFront distribution aliased to `matchday.percymain.org`, same us-east-1 cert (wildcard SAN already covers it), SPA rewrite (`/index.html` default root, 404 → 200 rewrite for deep links)
- Output the distribution domain name from the module
- DNS: add CNAME at Netlify `matchday → <cloudfront-domain>` (manual step, documented in phase PR description — not TF since DNS isn't in TF)
- S3 CORS on the `uploads` bucket: append `https://matchday.percymain.org` to allowed origins

### CI/CD

`.github/workflows/deploy.yml`:

- New `deploy-matchday-web` job, triggers on `apps/matchday/**` or `packages/shared/**` changes
- Build with `VITE_API_URL=https://api.v2.percymain.org/api`
- `aws s3 sync apps/matchday/dist s3://${MATCHDAY_FRONTEND_BUCKET}` with the same cache-control split (assets forever, index.html and JSON no-cache)
- Invalidate `/index.html` and `/*.json` on the matchday distribution
- Add `MATCHDAY_FRONTEND_BUCKET` and `MATCHDAY_DISTRIBUTION_ID` as GitHub Actions variables

### Home dashboard shell

One screen only — proves the pipeline:

- `/` route shows greeting: "Hi {user.name}" and role badge
- Nav bar placeholder (bottom tabs on mobile, sidebar on desktop)
- "Sign out" action
- Offline-aware toast (service worker registered, but no caching logic yet)

No real data yet. The next phases wire in the feeds.

## Acceptance criteria

- [ ] Visiting `https://matchday.percymain.org` while signed in on `https://www.percymain.org` shows the greeting — no second login
- [ ] Signing out on main site signs out on matchday (both directions)
- [ ] Visiting while signed out redirects to `percymain.org/login?redirect=...` and returns correctly
- [ ] Tested on real iOS Safari 17+ and Android Chrome — session cookie is readable cross-subdomain (no ITP block)
- [ ] Lighthouse PWA category passes "installable" on mobile Chrome
- [ ] CI deploys on merge and the matchday distribution is invalidated
- [ ] `pnpm run openapi:generate` emits the matchday client too (or the client imports from `apps/web/src/lib/api.gen.*` via tsconfig paths — document which)
- [ ] `pnpm test` and `pnpm typecheck` pass in the new workspace

## Risks / gotchas

- **Safari ITP is the biggest unknown.** Must verify on real devices in a hosted staging, not localhost. If it blocks cookies, the fallback plan is a reverse-proxy at CloudFront: route `matchday.percymain.org/api/auth/*` to the ALB so auth calls are same-origin from Safari's point of view. Design the CloudFront distribution to allow this even if we don't need it initially.
- **Passkey invalidation.** If any user has registered a passkey against an RP ID other than `percymain.org`, changing to `percymain.org` invalidates it. Check the `passkey` table; if non-empty, coordinate an email to affected users asking them to re-register.
- **Vite PWA SW caching index.html** — default behaviour caches `index.html`, which will serve stale app shells forever. Configure `injectRegister: 'auto'` + `workbox.cleanupOutdatedCaches: true` + a `self.skipWaiting()` strategy from day one.

## Estimate

1 engineer, ~1 week. Longer if the ITP fallback is needed (budget +3 days).
