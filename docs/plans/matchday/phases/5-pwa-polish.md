# Phase 5 — PWA polish

**Goal.** The app behaves like a phone app, not a webpage. Installable, useful offline, fast after first load.

**Non-goals.** Native wrapper, app store distribution, push notifications (parked — design space kept open, see §5 below).

## Deliverables

### Install experience

- Full PWA manifest: 192/512 maskable icons, theme colour matching club branding, `display: "standalone"`, shortcut icons for common actions (respond to availability, today's match)
- Custom install prompt: inline card on Home ("Install the matchday app — one tap to respond to availability") behind a dismissible state; triggers `beforeinstallprompt`
- iOS-specific instructions page: `Share → Add to Home Screen` (iOS Safari doesn't support `beforeinstallprompt`)
- Detect launched-as-PWA via `display-mode: standalone` media query — hide the install card in that state

### Offline — read-only

Scope is narrow. We cache what a player needs to read at a ground with no signal:

- App shell (HTML, JS, CSS, fonts) via Workbox precache
- `GET /availability/active`, `GET /matchday/:id` (for team sheets the user is on), `GET /charges`, `GET /games` (recent) via runtime cache with `StaleWhileRevalidate` strategy, TTL 24h
- Image assets (shadcn, club logo) via Workbox cache-first

What we do NOT cache offline:

- Admin screens (expense inbox) — admin work happens at a desk with a connection
- `POST`, `PUT`, `DELETE` mutations — these either succeed online or queue (see below)

### Offline — writes queue

For critical mutations that happen pitch-side:

- `POST /matchday/:id/players/:playerId/mark-paid` (captain marks cash paid at a ground with no signal)
- `POST /matchday/:id/expenses` (receipt photos — queue the upload)
- `POST /availability/requests/:id/respond` (player responds on a train, tunnel, etc)

Use Workbox Background Sync (`BackgroundSyncPlugin` on the service worker). On mutation failure due to network, request is queued; retries on `sync` event.

Client-side: optimistic UI immediately, toast "Will sync when back online". React Query mutation treats the optimistic update as ground truth until online confirmation.

**Not offline:** `POST /matchday/:id/confirm` and `POST /matchday/:id/finish`. These do too much (transactional writes, emails, charge creation) — requires-online, with a clear "you need to be online to do this" block.

### Install card / recent-activity cue

On home, subtle indicator:

- "You're online / offline" minimal badge
- "Last synced X minutes ago" under the card that most needs freshness (match-day view)

### Performance targets

- First Contentful Paint < 1.5s on a mid-range Android over 4G
- Time to Interactive < 3.5s on same
- Lighthouse PWA + Performance + Accessibility scores all > 90
- Route-level code splitting (lazy-load admin bundle for non-admin users)

## Push notifications (deferred, design open)

Not v1. But:

- Don't design anything that blocks push later
- Key events that would benefit: "Availability request opened", "You're on the team", "Match fee now due"
- iOS 16.4+ supports Web Push on installed PWAs — future-compatible
- The `user` table has `email` for email fallback; no `push_subscription` yet. When we revisit, add a `user_push_subscription` table and a `POST /push/subscribe` endpoint

## Acceptance criteria

- [ ] App is installable from Chrome / Edge on Android and desktop, and via Share > Add to Home Screen on iOS
- [ ] Cold open from home-screen icon in flight mode shows last-cached home dashboard
- [ ] A player in a tunnel can respond "available", and the response syncs when they reconnect — no data loss
- [ ] Captain can mark a player paid with no signal, sees the optimistic state, syncs on reconnect
- [ ] No uncached route produces a blank screen — always fall back to a friendly "you're offline, this needs a connection" card
- [ ] Lighthouse budgets met on CI (scored on `staging` build)
- [ ] Service worker updates cleanly — new deploys prompt "New version available, tap to reload" rather than silently breaking

## Risks / gotchas

- **Stale SW pinning.** If the service worker update strategy is wrong, users get stuck on an old app version until they force-reload. Use `registerSW` with `onNeedRefresh` and show a refresh prompt explicitly.
- **iOS quirks.** iOS PWA storage limits (50MB quota-ish, can be evicted aggressively), no access to `push` unless installed, no notification permission prompt on the web page itself. Test on real iOS 17+.
- **BackgroundSync support.** Not universal (Safari doesn't support it as of writing). For Safari, fall back to in-memory queue with retry on `online` event — works well enough since Safari is mostly not-installed.
- **Cache poisoning.** If a bugged build lands, it caches forever. Always version the cache name and provide a "clear cache and reload" button in `/me`.

## Estimate

1 engineer, ~1 week. Can start once phase 2 is merged.
