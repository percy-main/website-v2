# Phase 2 — Player experience

**Goal.** A player can open `matchday.percymain.org` and do everything they need: see what they owe, respond to availability, see where they're selected, see results.

**Audience.** Every signed-in user, regardless of role, gets this view by default. Officials and admins also see it — their extra surfaces come in phases 3 and 4 as additions.

## Deliverables

### Home dashboard (data-driven)

Replaces the phase 1 placeholder. Composition (top to bottom on mobile):

1. **Availability awaiting your response** — if any. Card with count ("4 dates to confirm") → starts the availability response flow.
2. **You're on the team** — upcoming matchdays where the user is a `matchday_player` with status `selected` or `playing` and the matchday status is `confirmed`. Card per match, tap to view team sheet.
3. **Match fees** — total outstanding from `GET /charges`, filtered to `type = "match_fee"`. "£15 outstanding across 3 matches" with a "Pay on the main site" CTA (opens `percymain.org/members/charges` in a new tab). Not paying here (see PLAN §5.7).
4. **Coming up** — next 3 senior fixtures (uses `GET /games?season=current`).
5. **Recent results** — last 3 played senior matches.

Each card is a react-query endpoint, renders independently, shows its own skeleton and error state.

### Availability response flow

Route: `/availability/respond`

Driven by `GET /availability/active` (returns all active requests + user's existing responses).

UX:

- Flatten across requests into an ordered list of **unanswered** dates (chronological)
- One date per screen: show fixture(s) on that date, two big buttons (Available / Unavailable), optional note field, Next button (disabled until chosen)
- Header: "2 of 4"
- "Apply same answer to all remaining" link on first screen (commits all and closes)
- On submit per date: optimistic; if offline, enqueue (phase 5 polish, but API the hook now)
- End state: green check + "All done" + link back home

Endpoint: `POST /availability/requests/:id/respond` (one per date — batch in a later optimisation).

Edge cases:

- No unanswered dates → "You're all caught up" state
- Already-answered dates accessible via a "Responses" tab (list view with edit inline)
- If a fixture's in the past by the time the user responds: show but disable

### Team sheet view

Route: `/matchday/:id`

Public-ish within-the-club: any signed-in user can see team sheets they're named on _or_ for teams they're a `team_official` of. For v1, simplification: any signed-in member can view any team sheet. (Privacy is weak today — team news image is posted publicly anyway.)

Uses `GET /matchday/:id`. Shows:

- Opposition, date, ground (home/away), competition, kit colours (if we have them — parked)
- Squad in confirmed order: name, captain crown, wicketkeeper gloves, dropped-out muted
- "I am" badge on the user's own row if they're in the squad
- For captains viewing their own match: a "Manage" link that jumps to the phase 3 captain live view

### Fees detail view

Route: `/fees`

- List of outstanding match-fee charges: date, opposition, amount, unpaid indicator
- Totals at top
- "Pay on the main site" button — deep link to `percymain.org/members/charges`
- History tab for paid charges

Uses `GET /charges` (filter client-side to `source = "matchday"` to keep matchday-scoped).

### Navigation

Finalise the bottom tab bar for the player audience:

- Home • Fixtures • Fees • Me

Officials and admins get extra tabs injected in phases 3 and 4.

## Acceptance criteria

- [ ] A player with 3 outstanding charges, 2 unanswered availability dates, and 1 upcoming team sheet sees all three blocks on home
- [ ] Availability response flow is fully keyboard-navigable and renders correctly on iOS Safari
- [ ] Team sheet page matches information density of a scorebook entry (captain/keeper clearly marked)
- [ ] Fees page deep-links correctly back to the main site Stripe flow
- [ ] Home dashboard loads the user's data inside 300ms on a warm cache (5 lightweight API calls in parallel)
- [ ] All states have loading skeletons and error fallbacks
- [ ] Existing `GET /games`, `GET /charges`, `GET /availability/active`, `GET /matchday/:id` endpoints all return data needed — no backend changes

## Risks / gotchas

- **`GET /matchday/:id` currently requires `official` or `admin` role** (routes.ts:94). For the team-sheet view to work for players, we need a new public-ish endpoint or widen this one. Cheapest fix: add a new `GET /matchday/:id/public` that returns a reduced shape (squad, captain, keeper, result — no expense data, no charge IDs) and keep the official one auth-gated. This is a small backend addition; not a redesign.
- **Date timezones.** `GET /availability/active` returns `match_date` as `YYYY-MM-DD`. Don't parse with `new Date(str)` (local vs UTC interpretation bites). Format with `date-fns/format` using the string directly.
- **"You're on the team" visibility window.** A `selected` matchday before team is `confirmed` should _not_ show to the player (the team's not announced yet). Filter to `matchday.status = "confirmed"`.

## Estimate

1 engineer, ~1 week.
