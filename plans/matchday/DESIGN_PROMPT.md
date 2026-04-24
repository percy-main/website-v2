# Design prompts for matchday.percymain.org

This directory's design prompts are split — give them to claude design **one at a time**, not all in one session, because each is its own design problem with distinct constraints.

- `DESIGN_PROMPT.md` (this file) — the **shell**: brand, design language, nav, auth/offline states, Home dashboard. Do this first — establishes the system.
- `DESIGN_PROMPT_player.md` — player-audience flows: availability response, team sheet, fees view.
- `DESIGN_PROMPT_official.md` — official-audience flows: availability management, team selection, confirm + roles, captain match-day view, expenses authoring.
- `DESIGN_PROMPT_admin.md` — admin-audience flows: expense approvals inbox, team news image generator, fee-rate admin.

Reuse the shell outputs in every subsequent prompt (tokens, components, nav).

---

# Shell prompt

## Context

You're designing the shell for a new mobile-first PWA at `matchday.percymain.org` for **Percy Main CSC**, an amateur cricket club in North Shields, UK. Existing website is `percymain.org` — keep visual continuity with that site (club crest, red/dark palette) but the matchday app gets a distinct, more app-like feel. Users come here to get a specific thing done and leave — it is not a marketing surface.

**Tech constraints.** React 18 + Vite + Tailwind + shadcn/ui. Ship production-quality React code. No Figma screenshots — generate working components.

**Audience.** Three role tiers, all in one app:

1. **Player** — weekday usage, phones, wants to know: am I picked, do I owe money, when's the game
2. **Official** (captain/manager) — peak usage is pitch-side on match day, often one-handed in wind with poor signal; weekday usage for picking teams
3. **Admin/treasurer** — weekly batch work, usually at a desk, reviewing expenses

All three see the same shell; additional nav tabs and home cards appear based on role.

## Design directives

### Tone and feel

- **Utility, not hype.** This is a tool amateur cricketers use to avoid admin, not a lifestyle app. No heroic imagery, no marketing copy, no gradient-mesh backgrounds.
- **Quiet and confident.** Generous whitespace, strong typography hierarchy, minimal chrome. The information is the design.
- **Pitch-side friendly.** Outdoor legibility — high contrast, large tap targets (44pt minimum), buttons not links for primary actions.
- **Brand nod.** Percy Main's colours are a deep navy (#0B1A2A or similar) and a club red (#C0272D ish). Use navy as the primary UI colour, red sparingly for emphasis (availability "unavailable", status badges, destructive). **Avoid** using red for anything non-destructive — confused signal.
- **Not "designed for kids".** The actual users are adults 20–60. Skew mature, not playful. Think Linear's restraint, not a banking app's stuffiness.

### Visual system

- **Typography.** A single sans family (Inter is fine). Scale: 12/14/16/18/24/32. Weight: 400 body, 500 labels, 600 section headings, 700 display.
- **Grid.** Mobile-first. Single column on phones; 2-col on tablet/desktop for lists/details; 3-col where it earns its keep (e.g. availability picker by status).
- **Colour roles.**
  - Surface: white / near-white; dark surface for standalone components on the match-day screen (captain mode)
  - Text: near-black / 70%-grey for secondary
  - Primary: navy
  - Accent: red (destructive, unavailable, overdue)
  - Success: green (available, paid)
  - Warning: amber (pending, draft, needs attention)
- **Iconography.** Lucide icons. A small set of cricket-specific glyphs where it helps: crown (captain), glove (wicketkeeper), ball (umpire fee).
- **Motion.** Fades and 150ms eases only. No bouncy spring animations. Respect `prefers-reduced-motion`.

### Density and layout

- **Home is a feed of cards.** Each card has a single purpose and a single primary action. No multi-action rows on home.
- **Details are dense.** Once the user has chosen what they're doing (squad list, availability per-date), density matters — they're doing work. Ok to show 12 players without scrolling.
- **Bottom tab bar on mobile.** Labels visible (not icon-only — mixed demographic). Active tab shown with a filled icon and primary colour; inactive greyscale. 4–6 tabs max.
- **Sidebar on desktop.** Same nav items, horizontal bar at top or collapsed rail on left — your call, but consistency across all prompts.

## Components to design

Produce production-grade React + Tailwind for:

### 1. App shell

- `AppShell.tsx` wrapping router output. Renders top header (brand, user avatar) + children + bottom tab bar
- Auth gate component — while session is loading, skeleton; if no session, redirect prompt (not UI-level, but design the "redirecting to sign in" state)
- Offline indicator — small unobtrusive badge, persistent when offline
- Service-worker update prompt — "New version available, tap to reload" toast

### 2. Navigation

- `BottomTabBar.tsx` — role-aware: Home / Fixtures / Fees / Me for players; + Squad + Availability for officials; + Approvals for admins
- `DesktopSideNav.tsx` — same items, responsive
- Active state logic based on current route

### 3. Home dashboard

- `HomeScreen.tsx` — a composed feed
- Individual cards, all interruptible and independently loading:
  - `AvailabilityAwaitingCard` — "You have 4 dates to confirm" → CTA
  - `SelectedInTeamCard` — one per upcoming team sheet the user's on
  - `OutstandingFeesCard` — total + "Pay on main site" action
  - `MatchDayPinCard` — prominent, for captain on the day (today only)
  - `UpcomingFixturesCard` — next 3 senior fixtures
  - `RecentResultsCard` — last 3 results
  - `PendingApprovalsCard` — admin-only, count of expenses to review
- Empty state for home ("No matchday activity this week")

### 4. Primitives / design tokens

- Extend shadcn Button with a `tone` prop (primary / destructive / success / ghost / outline)
- Status pill component reused for player status (playing/dropped-out/no-show), expense status (draft/submitted/approved/rejected/reimbursed), availability status (available/unavailable/no-response), and match status (pending/confirmed/finished) — unified system, not bespoke per feature
- Player row component (reused across team sheet, squad picker, per-date availability) — name, role icons, status pill, optional right-hand action

### 5. Auth / splash

- Unauthenticated state — "Redirecting to sign in..." minimal card
- First-run post-sign-in — brief welcome card "You're signed in as {name}. Tap Install to add Matchday to your home screen." with iOS-specific instructions fallback

## What not to design yet

- Specific flows — availability response, team selection, expense inbox (these come in the per-audience prompts)
- Empty-state illustrations — text-only is fine for now
- A logo — use the existing Percy Main crest
- Dark mode — system-respecting dark _is_ in scope (the captain on a sunny day + a player in bed both need to read the screen). Build both. Use Tailwind's `dark:` from day one.

## Deliverables

- Working `apps/matchday/src/components/shell/` with all components above
- `apps/matchday/src/components/primitives/` with the shared primitives
- Demonstrate each on a storybook-style `/design` route showing every state (loading / empty / error / populated / dark mode)
- Lighthouse accessibility score ≥ 95 on the demo route
- All copy in-place (no lorem ipsum)

## Taste guardrails

Things to actively avoid:

- Neon-bright gradients, glassmorphism, skeuomorphic shadows
- Twee imagery (cricket bat illustrations in empty states)
- More than two font weights on one screen
- Icon-only buttons without labels for primary actions
- Dense paragraphs of marketing copy — this is a utility app
- Splash screens longer than the real content takes to load
