# Frontend Migration Plan — React Island & Page Components

**Created:** 2026-03-16
**Migration status items:** "Port React island components" + "Port Astro-native components"

The v2 frontend scaffold, routing, auth flow, header/footer, and API client are already in place. All 20+ page stubs need their actual UI ported from v1.

---

## Batch 1: Members Dashboard + Payments + Simple Pages

**Status:** Done

**Scope:**

- Members dashboard (4 tabs: membership, details, security, payments)
  - Membership tab — shows membership type, dependents
  - Your Details tab — editable member profile (name, address, DOB, emergency contact)
  - Security tab — change password, passkeys, 2FA
  - Payments tab — charges table with Stripe payment, subscriptions list
- Purchase checkout page — Stripe one-off payment flow
- Payment confirm page — post-payment status from redirect
- Logout page — sign out + redirect
- Email confirmed page — verification success
- Not found (404) page

**Why first:** Makes the authenticated member experience functional. All API endpoints exist.

---

## Batch 2: Admin Panel

**Status:** Not Started

**Scope:**

- Admin panel with 11 tabs:
  1. Members table (search, filters, pagination, detail modal)
  2. Juniors table (grouped by team, linking dialog)
  3. Charges table (filters, aggregates, Stripe sync, chase payment)
  4. Contact submissions
  5. Sponsorships management
  6. Duplicate members
  7. Match fee rates
  8. Record linking (Play Cricket + Contentful)
  9. Game reports
  10. Treasurer dashboard (income chart, membership/sponsorship summaries, expenses)
  11. Fantasy admin (player management, chaos weeks)

**Why second:** Most complex single page. Admin-only so lower user impact, but critical for operations.

---

## Batch 3: Public Data Pages

**Status:** Not Started

**Scope:**

- Cricket leaderboard (filtering by team/competition, batting/bowling tabs)
- Calendar overview + month view + event detail
- News list + article + tag filter (content from Contentful — will need interim approach or Phase 5)
- Person directory + profile (Contentful-dependent)
- Privacy policy page
- Nets page

**Notes:** News, person, and content pages depend on Contentful data being replaced (Phase 5). Leaderboard and calendar can call existing Play Cricket API endpoints. May need interim API endpoints for content or simple stubs.

---

## Batch 4: Interactive Features

**Status:** Not Started

**Scope:**

- Fantasy cricket (home, team management, leaderboards, rules)
- Be The Keeper game (canvas-based catching game + leaderboard)
- Junior manager panel (team/player management)
- Official panel (matchday expenses)
- Game/player sponsorship pages

**Notes:** Fantasy and Be The Keeper are self-contained React apps. Junior manager and official panels are role-gated.

---

## Adaptation Patterns (v1 → v2)

| v1 Pattern                           | v2 Pattern                                            |
| ------------------------------------ | ----------------------------------------------------- |
| `actions.feature.method()`           | `api.get/post("/api/path")` with React Query          |
| `authClient` (direct import)         | `authClient` from `@/lib/auth-client`                 |
| `useSession()` from astro auth       | `useSession()` from `@/lib/auth-client`               |
| `navigate("/path")` (Astro)          | `useNavigate()` from React Router                     |
| URL search params (manual)           | `useSearchParam` hook or `useSearchParams`            |
| `client:only="react"`                | Standard React component (SPA — everything is client) |
| Astro action error handling `.error` | API client throws on non-2xx, catch in mutation       |
