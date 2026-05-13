# Matchday App Redevelopment — Plan

Status: **draft, pending review**
Target: new SPA at `matchday.percymain.org`
Owner: @alexyoung

## 1. Context

The current matchday experience is spread across the main site:

- `/matchday` — member hub showing the active availability request
- `/official` — a 54 KB "god page" covering team management, match setup, player selection, team news images, expenses, roles, finish flow
- `/official/availability` — a 40 KB availability request management page
- `/admin/*` tabs — expense approval, match-fee rates, treasurer view

Officials report the flows are slow, cluttered, and hard to do pitch-side on a phone. Players get one availability card at a time, no visibility into team sheets once they're announced, no view of outstanding match-fee charges in the matchday flow.

The redevelopment moves the matchday experience out of the main site into a **dedicated, mobile-first PWA** at `matchday.percymain.org`, reusing the existing Fastify API unchanged.

## 2. Goals / non-goals

### In scope (v1)

- Dedicated PWA for matchday activities — installable, offline-read for today's team sheet/fixture, writes queue when back online
- Three audiences in one app, all gated by existing roles: **player**, **official** (includes captain/manager), **admin**
- All existing flows covered: availability, team selection, pre-match confirmation, post-match (fees, expenses, finish), image generation
- Cross-subdomain auth — sign in once on the main site, stay signed in on matchday
- Parallel rollout with existing pages (three-stage cutover)

### Out of scope (v1)

- Backend rework — no service/schema changes beyond trivial additions needed for new views
- Role taxonomy expansion — roles stay flat (`user | member | official | admin`)
- Junior matchday — seniors only
- Player-side pre-match confirmation step (availability response = commitment)
- Payment UI — Stripe charges/settlement stay on the main site's member account
- Auto-posting team news images to social channels (manual download only)
- Native app / app store distribution
- New image types (result card, player-of-the-match) — only existing team-news PNG
- Notifications (web push) — deferred to a later phase but the app is designed to accept them when ready

## 3. Personas

### Player (role: `member`, also `official` and `admin` fall back to this view by default)

- Opens the app on their phone during the week
- Wants to: respond to availability requests, see if they're picked, see the team sheet, see any fees they owe, see match result
- Primary context: at home, on a train, quickly between meetings

### Captain (role: `official`, assigned as captain for a specific matchday)

- Opens the app pitch-side before and after a match
- Wants to: view the squad, mark players paid (cash), confirm late changes (drop-out, no-show), record expenses (umpire fee, teas), post the result, download team news image earlier in the week
- Primary context: windy, one-handed, spotty 4G

### Manager / fixture secretary (role: `official`)

- Opens the app during the week, usually desktop
- Wants to: open an availability request across several weeks of fixtures, chase non-responders, pick the team, confirm the squad, assign captain/keeper
- Primary context: sitting at a desk, batch work

### Admin / treasurer (role: `admin`)

- Opens the app after matches to review and reimburse
- Wants to: approve/reject submitted expenses, reimburse approved ones, see the pending queue
- Primary context: weekly batch, desktop

Roles are **flat** in auth. Captain/manager surfacing is purely UI, driven by match-level role assignment (`matchday_player.is_captain`) and team-official membership (`team_official` join). Image generation is **admin-only** (permission tightens from today's official-level).

## 4. Information architecture

### Top-level navigation (bottom tab bar on mobile, sidebar on desktop)

1. **Home** — personalised feed: availability requests awaiting your response, team sheets you're on, your outstanding charges, upcoming fixtures, recent results
2. **Fixtures** — schedule of all senior fixtures, filterable by team; anyone logged in can browse
3. **Squad** — (official only) view into squads for the teams I'm an official of; create matchdays, pick teams, confirm
4. **Availability** — (official only) list of open/closed requests, create new, chase non-responders
5. **Expenses** — dual-role:
   - For officials: "my expenses" — record draft, submit claim, see status
   - For admins: "pending" inbox with approve/reject/reimburse
6. **Me** — profile, roles I hold, sign out, app version, install PWA prompt

Items 3, 4, and the admin side of 5 appear only when the user has the role. Users never see nav items they can't use.

### Detail routes

- `/fixture/:matchId` — fixture detail (public shape): date, opposition, ground, result if played
- `/matchday/:matchdayId` — full matchday: squad, captain/keeper, expenses, fees, result
- `/availability/:requestId` — request detail with date tabs
- `/availability/:requestId/date/:date` — per-date picker and response view
- `/expenses/:expenseId` — expense detail (approver view or author view)

### Home dashboard composition (by role)

| Block                               | Player | Official        | Admin |
| ----------------------------------- | ------ | --------------- | ----- |
| Availability awaiting response      | ✓      | ✓               | ✓     |
| Team sheets I'm named in (upcoming) | ✓      | ✓               | ✓     |
| Outstanding match fees              | ✓      | ✓               | ✓     |
| Open availability requests I own    | —      | ✓               | ✓     |
| Matches I need to confirm (captain) | —      | ✓ (if assigned) | —     |
| Expenses awaiting approval          | —      | —               | ✓     |
| Recent results                      | ✓      | ✓               | ✓     |

## 5. Flows — what changes

Endpoints are unchanged. UX changes below.

### 5.1 Availability — player response

**Today.** One card per fixture date under the main-site matchday page. Long list once an official has opened a multi-week window. No at-a-glance "these are the dates you haven't answered yet".

**New.** On home, a single "You have 4 dates to confirm" card linking into a full-screen responsive flow:

- Stepper through unanswered dates (Tinder-style swipe available / unavailable is _not_ what we want — too easy to slip)
- Each date shows all fixtures on that day (often two senior sides have fixtures same Saturday); single available/unavailable choice applies to the date, optional note
- "Apply to all remaining" for holidays etc
- Progress indicator
- Submit is optimistic; failure queues for later

Endpoints: `GET /availability/active`, `POST /availability/requests/:id/respond`.

### 5.2 Availability — management (official)

**Today.** One giant 40 KB page.

**New.** Three surfaces:

- **List view** — open and recent requests, fixture/respondent counts, quick "notify non-responders" action
- **Request detail** — date tabs (list of dates in the request), each with response summary (N available / M unavailable / K no-response) and a one-tap "view" into the per-date screen
- **Per-date picker** — three columns on desktop / three tabs on mobile: Available, Unavailable, No response. Tap a player to assign to a specific fixture; drag on desktop. Copy-previous-week option.

Create-request is a dedicated flow with a date-range picker, preview (calls `/availability/preview`), then confirm.

### 5.3 Team selection

**Today.** Pick players from a search box inside the giant official page; it's easy to lose track of who's confirmed available vs who was assigned in the availability flow.

**New.** Starting point is the availability **assignments** from 5.2 — if the availability flow is used end-to-end, selecting the squad becomes one-tap ("use these assignments as the starting squad"). Then:

- Add/remove players from a player list that shows: is this person available? Has someone else already selected them? (cross-team conflict warning)
- Guest player entry stays, but clearly visually distinct

Endpoints unchanged: `GET /matchday/members/search`, `POST /matchday/:id/players`, `DELETE /matchday/:id/players/:id`.

### 5.4 Pre-match — confirm + roles + team news

**Today.** Officials tick playing/dropped-out/no-show inline and set captain/keeper via fiddly dropdowns.

**New.**

- Confirm screen is a checklist with drag handles: playing players on top, drop-outs below the fold. Tap a player to set captain (crown icon) or keeper (gloves icon); once captain is set, surface captain-specific actions on subsequent screens for that user only.
- Team news image: admin-only (new permission tightening). Admin navigates to the confirmed matchday and taps "Generate team news image". Home/away and match time are inputs with sensible defaults (home = team's home ground, match time = the Play-Cricket match time if we have it, otherwise 13:00). Returns PNG to download.

Endpoints: `POST /matchday/:id/confirm`, `PUT /matchday/:id/roles`, `GET /matchday/:id/team-news-image` (move preHandler from `officialRole` to `adminRole`).

### 5.5 Matchday — captain live view + mark paid + finish

**Today.** Same giant official page. Mark-paid and finish buried a few taps in.

**New.** If you are the assigned captain (or official for this team), the home dashboard pins today's match as a big "Match day" card. Tap → dedicated single-screen layout:

- Top: opposition, start time, ground
- Middle: squad with a "paid" toggle per player and payment method dropdown (cash / bank / card — card usually ticked only if already paid via the main site)
- Bottom: result picker (radio: W / L / D / T / A / C / N), Finish button
- Expense quick-add button (floating action button) → bottom sheet with type + amount + optional photo

Finish flow has a confirmation step summarising: "3 players unpaid — they'll be charged £X each. 2 draft expenses submitted. Email notifications sent." Then explicit Finish.

Endpoints unchanged: `POST /matchday/:id/players/:id/mark-paid`, `POST /matchday/:id/expenses`, `POST /matchday/:id/finish`.

### 5.6 Post-match — expenses (admin / treasurer)

**Today.** Spread across admin `expense-history-tab`, `treasurer-tab`, etc.

**New.** Single "Expenses" area with two tabs:

- **Pending** — queue of submitted expenses, each with receipt preview, amount, creator, match context; approve / reject-with-reason / reimburse inline
- **History** — filterable by status, team, date range

Endpoints unchanged: `GET /matchday/expenses/pending`, `POST /matchday/expenses/:id/approve` / `reject` / `reimburse`.

### 5.7 Charges view (player)

**Today.** Charges live on the main-site member page, separate from matchday.

**New.** A "Match fees" card on home shows total outstanding and a "Pay now" link. Pay flow stays on the main site (reuses `GET /charges`, `POST /charges/pay-outstanding`, `POST /charges/confirm-payment` — we _view_ here, but _pay_ via the main site's member-area Stripe flow to avoid re-doing the Stripe UI. Revisit in a later phase if we want pay-in-matchday).

## 6. Tech stack

| Concern       | Choice                                                                             | Notes                                                       |
| ------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Framework     | React 18 + Vite                                                                    | Matches main site                                           |
| Routing       | react-router v7                                                                    | Matches main site                                           |
| Data fetching | TanStack Query + typed client from `api.gen.d.ts`                                  | Reuse `api.gen.json` generation pipeline                    |
| UI            | shadcn/ui + Tailwind                                                               | Matches main site; may diverge into matchday-tuned variants |
| Forms         | react-hook-form + zod (shared schemas from `@percy-main/shared`)                   | Matches main site                                           |
| Auth          | better-auth client (cross-subdomain session, see §7)                               |                                                             |
| PWA           | `vite-plugin-pwa` + Workbox                                                        | Offline read; install prompt; future web push               |
| Build/deploy  | pnpm workspace app `apps/matchday`; built to its own S3 bucket + CloudFront origin | See §8                                                      |

Shared assumptions:

- The existing OpenAPI spec covers everything we need. Each endpoint the matchday app calls is already in `apps/web/src/lib/api.gen.json`.
- The design system moves toward a shared package only if we find ourselves duplicating components — not a prerequisite.

## 7. Auth — cross-subdomain

All three subdomains (`percymain.org`, `www.percymain.org`, `matchday.percymain.org`) share one better-auth session issued by `api.v2.percymain.org` via a cookie scoped to `.percymain.org`.

### API changes (`apps/api/src/features/auth/auth.ts`)

```ts
betterAuth({
  baseURL: apiBaseURL,
  basePath: "/api/auth",
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      domain: ".percymain.org",
    },
    useSecureCookies: isProduction,
  },
  trustedOrigins: [
    "https://percymain.org",
    "https://www.percymain.org",
    "https://matchday.percymain.org",
    config.DEPLOY_PRIME_URL,
  ].filter(Boolean),
  // ... existing plugins
});
```

### CORS (`apps/api/src/app.ts`)

Expand from single `config.BASE_URL` to a list (or regex) including all three public origins plus preview URL.

### S3 CORS (`infra/modules/cdn/main.tf`)

Add `https://matchday.percymain.org` to allowed origins for `uploads` bucket (receipt images).

### Passkey RP ID (`BETTER_AUTH_RP_ID` env var)

Today's default is `localhost`. Production needs to be set to `percymain.org` (apex, not a subdomain) so passkeys registered on the main site work on matchday.

### Login redirect

Unauthenticated visit to `matchday.percymain.org` → `window.location = https://percymain.org/login?redirect=<urlencoded current URL>`. Main site's login page reads `redirect`, validates it's in the `.percymain.org` family, then `window.location` back after successful login. This is a ~20-line change on the main site.

### Dev

Switch dev stack to `*.localhost` subdomains (`api.localhost:3000`, `app.localhost:5173`, `matchday.localhost:5174`). Browsers treat `*.localhost` as cookieable. `/etc/hosts` entries or systemd-resolved depending on OS; document in README. Disable `useSecureCookies` in dev.

### Version note

The repo is on `better-auth ^1.5.4`. Cross-sub-domain cookies underwent a security fix in 1.6.7; plan to upgrade to latest stable before ship and test Safari ITP behaviour explicitly (known pain point for cross-subdomain cookies on Safari mobile).

## 8. Infrastructure

Good news: the us-east-1 CloudFront ACM cert already has a `*.percymain.org` SAN (see `infra/environments/shared/main.tf:196–207`). **No cert change needed**.

### Route 53 / DNS

DNS for `percymain.org` is currently at Netlify (only `api.v2.percymain.org` is in Route 53). Add a CNAME at Netlify: `matchday` → the CloudFront distribution domain. Or, move the apex to Route 53 at some point — tracked separately, not in scope here.

### CloudFront + S3

Two options. I recommend **option A** (clean isolation):

**A. New S3 bucket + separate CloudFront distribution** for matchday. Independent invalidation, independent deploy cadence, no risk of a matchday deploy affecting the main site cache. Cost: one extra distribution (~$0).

**B. Shared distribution, new origin + path-based routing on a behaviour.** Cheaper conceptually, but the matchday app needs to live under `/matchday/*` or similar _or_ we need a host-based behaviour — CloudFront routes by path not host on the same distribution, so this means invasive routing config. Skip.

Implementation (option A): in `infra/modules/cdn/` add a new module (or extend existing) to create `percy-main-${env}-matchday` bucket, OAC policy, a second CloudFront distribution aliased to `matchday.percymain.org`, default root `/index.html` rewrite for SPA. Apply via production env only (dev uses localhost).

### CI/CD (`.github/workflows/deploy.yml`)

Add a `deploy-matchday-web` job:

- Triggers on changes to `apps/matchday/**` or `packages/shared/**`
- Builds with `VITE_API_URL=https://api.v2.percymain.org/api`
- Syncs `apps/matchday/dist` to the matchday bucket
- Invalidates `/index.html` and `/*.json` on the matchday distribution
- Runs after the backend deploy if both changed

## 9. Rollout — three stages

1. **Parallel live.** New app deployed to `matchday.percymain.org` in production. Main-site links to `/matchday`, `/official/*` are unchanged. Officials/players opt-in by typing the URL or getting a link from the club's captains chat. This is our real-world test. Duration: two match weekends minimum.
2. **Flip links.** Once we're confident, update main-site navigation and matchday-related links to point at `matchday.percymain.org`. Add 301 redirects from `/matchday`, `/matchday/*`, `/official/availability`, `/official` to the equivalent new-app routes.
3. **Delete old.** Remove `apps/web/src/pages/matchday/`, `apps/web/src/pages/official/`, and migrate admin matchday-related tabs (`expense-history-tab`, `match-fees-tab`, `treasurer-tab`) into the new app. Charges remain a separate flow on the main site.

At each stage: run the full flow end-to-end (create availability → respond → pick team → confirm → finish) on a real fixture before advancing.

## 10. Phases

See `phases/` for detail. Summary:

1. `1-foundation.md` — new app scaffold, cross-subdomain auth, PWA skeleton, infra, CI/CD, home dashboard shell
2. `2-player.md` — home dashboard, availability response flow, team-sheet view, fees view
3. `3-official.md` — availability management, team selection, confirm + roles, captain match day view, finish, expenses record/submit
4. `4-admin.md` — expense approval inbox, team news image generator, fees/rate admin
5. `5-pwa-polish.md` — offline read for today's data, install prompt, basic add-to-homescreen UX, service-worker asset caching
6. `6-cutover.md` — flip main-site links, add 301s, delete old FE pages

Phases 2–4 can run in parallel by different devs once phase 1 lands. Phase 5 can start once phase 2 is merged.

## 11. Risks / open questions

- **Safari ITP** blocking cross-subdomain cookies on iOS. Mitigation: test early on real iOS 17 devices in a hosted staging env, not localhost. Fallback: reverse-proxy `api.percymain.org/api/*` behind `matchday.percymain.org/api/*` and keep cookies same-origin. Track as a phase-1 verification gate.
- **Charges-on-matchday temptation creep.** Tempting to move the Stripe pay-now UI into matchday. Don't — keep the scope honest for v1.
- **Captain assignment ambiguity.** The "you're captain for this match" UI hinges on `matchday_player.is_captain` being set _before_ the player opens the app. If the manager hasn't set it, the captain gets no pinned card. Mitigation: if the user is in the `team_official` join for the team of an upcoming fixture, still surface it as "you might be captaining this" with a nudge.
- **Guest members**. Today's `addPlayer` creates bare member records on the fly. The new UI should let the captain add a guest but flag clearly "won't receive fee emails" — the email on the member record is empty.
- **Image generation role tightening.** Moving team-news from `official` → `admin` is a product change — please confirm with product review. The rationale is that the image represents the club publicly.
- **Passkey cross-subdomain.** Setting `BETTER_AUTH_RP_ID` to `percymain.org` is required; worth confirming no existing passkeys would be invalidated (if any are registered against a subdomain they'd need re-registering).
