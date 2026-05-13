# Phase 6 — Cutover

**Goal.** Retire the matchday surfaces on the main site. Single URL for matchday from this point on.

**Prerequisite.** Phases 1–4 in production at `matchday.percymain.org`, exercised through two full match weekends with real users without showstoppers.

## Deliverables

### Step A — flip main-site navigation

Change main-site nav items from internal routes to `matchday.percymain.org`:

- `apps/web/src/components/header.tsx` (or wherever top nav lives) — `/matchday` link → `https://matchday.percymain.org`
- Any in-page CTAs on the main site pointing at `/matchday`, `/official`, `/official/availability`
- Email templates that link into matchday flows (e.g. ChargeNotification, availability notification) — audit `packages/email/`, update to absolute URLs at `matchday.percymain.org`

### Step B — 301 redirects

In `apps/web/src/router.tsx` (or the appropriate catchall), for these paths return a React component that `window.location.replace`s to the matchday URL:

| Main-site path           | Redirect to                                            |
| ------------------------ | ------------------------------------------------------ |
| `/matchday`              | `https://matchday.percymain.org/`                      |
| `/matchday/:matchId`     | `https://matchday.percymain.org/matchday/:matchId`     |
| `/matchday/teams`        | `https://matchday.percymain.org/squad`                 |
| `/matchday/availability` | `https://matchday.percymain.org/availability/respond`  |
| `/official`              | `https://matchday.percymain.org/squad`                 |
| `/official/availability` | `https://matchday.percymain.org/official/availability` |

SPA redirects aren't true 301s (CloudFront/S3 doesn't serve HTTP 301 for dynamic paths), but the redirect component plus `<meta http-equiv="refresh">` in a no-JS fallback is good enough. For bookmarks that matter, a CloudFront function-level redirect would be stronger — only add if a real case appears.

### Step C — delete the old pages

Remove:

- `apps/web/src/pages/matchday/` (entire directory)
- `apps/web/src/pages/official/` (entire directory)
- Admin tabs that moved: `apps/web/src/pages/admin/expense-history-tab.tsx`, `apps/web/src/pages/admin/match-fees-tab.tsx`, `apps/web/src/pages/admin/treasurer-tab.tsx`
- Any components/hooks used only by those pages (verify via grep before deleting)
- The redirect component from Step B _once_ analytics show redirect hits have dropped to near zero (leave for 3 months)

Keep:

- `apps/web/src/pages/admin/charges-tab.tsx` — charges admin stays on the main site for v1 (see phase 4)
- Anything referenced by matchday endpoints the API uses (no impact — API unchanged)

### Step D — remove old API route coupling

The matchday API routes (`/matchday/*`, `/availability/*`, `/matchday/expenses/*`) stay — the matchday app uses them. Nothing to delete on the backend.

Update CORS `origin` array in `apps/api/src/app.ts` if we want to lock it down: drop origins that no longer need matchday API access (none that I can see — the main site still needs `/charges/*`).

## Acceptance criteria

- [ ] All main-site nav links pointing at matchday now hit `matchday.percymain.org`
- [ ] Old URLs still redirect (not 404) for at least 3 months post-cutover
- [ ] Email templates link to the new domain
- [ ] No dead imports left from removed pages (eslint unused-imports catches this)
- [ ] Main-site bundle size drops measurably (matchday/official pages are a non-trivial chunk)

## Risks / gotchas

- **Bookmark rot.** Captains bookmark `percymain.org/official`. If we delete the route without a redirect, they hit 404. Keep redirects for ≥ 3 months.
- **Email link rot.** Old emails sent _before_ cutover contain `percymain.org/members/login?redirect=/matchday/<id>`. As long as the redirect is in place, these continue to work. Don't forget about the email template URL update _and_ the redirect.
- **Mobile shortcuts.** Users who added `percymain.org/matchday` to their home screen before phase 5's install prompt will keep hitting the old URL. Give them a grace window, then deprecate.

## Estimate

1 engineer, ~2 days.
