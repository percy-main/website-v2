# Design prompt — Official / captain flows

**Prerequisite.** Shell prompt (`DESIGN_PROMPT.md`) and player prompt (`DESIGN_PROMPT_player.md`) have been run. Reuse primitives (player row, status pill, AppShell, tab bar).

## Context

Designing the official-facing flows. "Official" covers two distinct jobs in the UX, even though auth is flat:

1. **Manager / fixture secretary** — weekday, desktop or tablet, batch work: create availability requests, pick teams, notify players. Sits at a laptop with coffee.
2. **Captain** — match day, phone, pitch-side: mark players paid, record cash expenses, post the result. Often one-handed, windy, 4G dropping in and out.

Both roles use the same URL, same auth, same role flag. The difference is **situational** — which actions they're trying to complete.

These users are also, usually, players themselves. They use the player flows too; these pages are additional surfaces, not a separate app.

## Flows to design

### Flow 1 — Availability: list + create

**Entry:** Availability tab (officials only)

Route: `/official/availability`

List of open and recent requests, most recent first. Each card:

- Date range
- Fixture count
- Response progress bar (respondentCount / expected)
- Status pill (Open / Closed)
- Quick actions: "Nudge non-responders", "View"
- Tap anywhere → detail

Top-right: Create new availability request (primary button).

#### Create

Route: `/official/availability/new`

- Step 1: date range picker (from / to, defaults to this week → end of next week)
- Step 2: preview — fixtures auto-loaded from Play-Cricket, can toggle off individual fixtures if needed
- Step 3: initial recipients — list with checkboxes (default: all senior-eligible members), preview email content
- Confirm → creates request + fires initial notifications

### Flow 2 — Availability: manage a request

Route: `/official/availability/:id`

Header: date range, status, response summary ("12 of 18 responded, 6 chasing").

Body:

- Date tabs in chronological order (scroll horizontally on mobile)
- For each date: fixture list + counts (Available N / Unavailable M / No response K)
- Tap a date → per-date picker (flow 3)

Footer:

- Chase non-responders button (opens recipient picker → email send)
- Close request button (confirmation modal; enumerates how many dates have no response)

### Flow 3 — Availability: per-date picker

Route: `/official/availability/:id/date/:date`

**This is the densest manager screen. Design carefully.**

Desktop layout (3-column):

```
| Available (12)     | Unavailable (4)    | No response (2)   |
| ------------------ | ------------------ | ----------------- |
| Smith         →    | Young   "holiday"  | Jones             |
| Jackson       →    | Scott              | [nudge]           |
| Holroyd (wk)  →    | ...                |                   |
| [drag or tap →]    |                    |                   |
```

Mobile: three tabs (Available / Unavailable / No response), otherwise same.

Tap a name in Available → assign dialog: pick a fixture on the date (if multiple), optionally pick a position. Assignments show as a chevron + team name on that row.

Assigned players (for the fixtures on this date) pinned at the top with team colour.

Right rail / bottom sheet: **current assignments per fixture**:

- 1st XI vs Tynemouth: 9 of 11 assigned
  - List of 9 with drag to reorder position
- 2nd XI vs Backworth: 5 of 11 assigned

Override: long-press (mobile) / right-click (desktop) a player → "Force available / unavailable" with confirmation and reason.

Top-right actions: "Use as starting squad" → creates matchday records prefilled with the assignments (links to flow 5).

### Flow 4 — Squad: teams dashboard

**Entry:** Squad tab (officials only)

Route: `/squad`

List of teams I'm an official of (from `team_official`):

- Team name + upcoming matches count
- Tap → team detail

Team detail: matchdays grouped by status (Upcoming pending / Confirmed / Played). Create-new button at top.

### Flow 5 — Squad: create matchday + pick team

Route: `/squad/new` → `/matchday/:id/edit`

Create:

- Pick team (if multiple)
- List of upcoming fixtures from Play-Cricket (filtered to this team, date ≥ today), with "already created" markers
- Tap fixture → creates matchday record, navigates to edit

Edit (squad picker):

- If availability assignments exist for this date/team: banner "Availability suggests X, Y, Z — use as starting squad" with one-tap apply
- Search box: type name → suggestions from `members/search`
- Selected squad list with add/remove, chevron to view the member's recent availability
- "Add guest" link → opens a dialog: name input, clear note "guests don't receive fee emails"
- Conflict warning per player: if they're selected for another match same date → amber warning inline
- Mobile: list is one-col with sticky search. Desktop: 2-col, search left, squad right.

Primary action: Continue → Confirm (flow 6).

### Flow 6 — Confirm team + set roles

Route: `/matchday/:id/confirm`

Three-step stepper.

**Step 1: Statuses.**

- List of all selected players (playing by default)
- Each row: status toggle — Playing / Dropped out / No-show (radio group)
- Drag to reorder if manager cares about batting order (out of scope unless trivial)

**Step 2: Roles.**

- List of playing players only
- Tap a player → radio: None / Captain / Keeper
- Visual: crown appears on captain row, gloves on keeper row
- Enforce: one captain, one keeper (client-side validation)

**Step 3: Review.**

- Summary: N playing, M dropped out, K no-show
- Expected charges: grouped by fee category with counts and amounts (e.g. "8 × adult @ £5 = £40; 2 × student @ £3 = £6")
- Confirm button (destructive tone — large, navy) — "This will create charges and cannot be undone."

Post-confirm: redirect to matchday detail with banner "Team confirmed. {Admin can now generate team news image.}"

### Flow 7 — Captain match day

**This is the single most important phone screen in the app.**

Route: `/matchday/:id/live`

Only visible to the assigned captain (`is_captain`) or any team official.

Layout (mobile, portrait):

```
┌────────────────────────────────┐
│  1st XI vs Tynemouth           │  ← compact header, sticky
│  13:00 • Home • League         │
├────────────────────────────────┤
│                                │
│  Squad (11)                    │
│                                │
│  ○ Smith          £5    [cash▾]│  ← row: unpaid
│  ○ Jackson        £5    [—]    │
│  ● Holroyd (wk)   paid         │  ← row: paid (green tick)
│  ● Young (c)      paid         │
│  ...                           │
│                                │
│  Drop-outs (2) ▸               │  ← collapsed
│                                │
├────────────────────────────────┤
│  ┌────┐                        │  ← FAB bottom-right
│  │ + £│  ← add expense          │
│  └────┘                        │
├────────────────────────────────┤
│  Result:  W  L  D  T  A  C  N  │  ← only after all squad confirmed
│  [ Finish match ]              │
└────────────────────────────────┘
```

- Each player row: name, role icons, amount due (or "paid" green), payment method dropdown on tap if unpaid
- Tap the circle / amount → marks paid, optimistic, payment method from dropdown (cash default)
- Status pill on the row updates green
- Huge tap targets — designed for cold hands with gloves
- Drop-outs collapsed, expandable
- FAB opens add-expense sheet: type (radio chips: umpire / scorer / ball / teas / misc), amount (£ input, keypad optimised), description (optional), camera / photo picker for receipt. Auto-resizes image client-side before upload.
- Result row: appears at the bottom once confirmation is done; radio buttons W/L/D/T/A/C/N with full labels on long-press
- Finish match: opens confirmation sheet — "3 players unpaid (will be charged £15). 2 expenses (will be submitted). 3 emails to send. Confirm?"

Offline indicator banner at the top when offline. Rows still tap-interactive (queued).

### Flow 8 — Official expenses

Route: `/expenses/mine`

List of matchdays where user has recorded expenses, grouped by status.

- Draft: edit / submit / delete
- Submitted: read-only with "awaiting approval" amber pill
- Approved: read-only with green pill
- Rejected: read-only with red pill and reason inline

Tap a row → matchday detail's expenses section, where edit/submit controls live.

## Interaction & tone

- **Confidence, not caution.** Officials are experienced with the club admin; don't handhold. Remove friction.
- **Destructive actions get confirmation, not warnings.** One modal, not a checklist of scares.
- **Pitch-side = forgiving.** On the match-day view, optimistic UI, offline queue, no multi-tap confirmations to mark paid.
- **Desktop parity.** Squad picker and availability management are just as usable on a 13" laptop as a phone.

## Deliverables

Working React + Tailwind for each route:

- `apps/matchday/src/pages/official/availability/*`
- `apps/matchday/src/pages/official/squad/*`
- `apps/matchday/src/pages/matchday/[id]/edit.tsx`
- `apps/matchday/src/pages/matchday/[id]/confirm.tsx`
- `apps/matchday/src/pages/matchday/[id]/live.tsx`
- `apps/matchday/src/pages/expenses/mine.tsx`

Demo every state on the `/design` route. Test the captain-live view in mobile portrait landscape and desktop — density must hold.
