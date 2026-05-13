# Phase 3 — Official / captain experience

**Goal.** An official can run a match end-to-end on a phone: open an availability request, pick a team, confirm, set captain/keeper, mark fees paid pitch-side, record an expense, and finish the match. A captain gets a focused "match day" view.

## Deliverables

### Additional nav for officials

Inject into the tab bar when the signed-in user has role `official` or `admin`:

- **Squad** — teams I manage, matchdays I've created, one-tap create-new
- **Availability** — open and recent requests

### Availability management

Routes:

- `/official/availability` — list
- `/official/availability/new` — create
- `/official/availability/:id` — detail with date tabs
- `/official/availability/:id/date/:date` — per-date picker

**List view.** Each request card shows: date range, fixture count, response progress bar (`respondentCount / eligible count`). Quick actions: chase non-responders, close request.

**Create flow.** Date-range picker → `GET /availability/preview?dateFrom=&dateTo=` → preview of fixtures that will be included → confirm creates request (`POST /availability/requests`) + surfaces recipient picker for the initial notification (`POST /availability/requests/:id/notify/preview` then `/send`).

**Detail view.** Date tabs (sorted chronological). Per date: counts (N available, M unavailable, K no-response) and a View action → per-date picker.

**Per-date picker.** Three sections (desktop: columns, mobile: tabs):

- Available — draggable (desktop) / long-press assign (mobile) to a specific fixture
- Unavailable — visible but grey
- No response — visible with a "nudge" action (sends individual email)

Assignment management uses `POST /availability/requests/:id/dates/:date/assign` and `DELETE /availability/assignments/:id`.

Override mechanism (`PUT /availability/responses/:id/override`) surfaced as "force as available/unavailable" behind a confirmation — rare action, don't make it accidental.

Close-request (`PATCH /availability/requests/:id` with `status: "closed"`) guarded with a confirm: "8 dates have no response — close anyway?".

### Team selection

Routes:

- `/squad` — list of teams I'm an official of, with matchdays grouped by status
- `/squad/new` — create matchday (pick team, date — `GET /matchday/teams` + `GET /matchday/teams/:id/upcoming`)
- `/matchday/:id` (official view, extends phase 2 view) — adds "Manage" mode

**Create.** Pick team → list of upcoming fixtures from Play-Cricket with existing-matchday markers → tap to create matchday record (`POST /matchday`).

**Manage mode.** Visible only to officials of the team (derive from `team_official` — if user isn't assigned, show view-only):

- Player list with add/remove (`GET /matchday/members/search` → `POST /matchday/:id/players`, `DELETE /matchday/:id/players/:playerId`)
- "Start squad from availability assignments" — if an availability assignment exists for this date+team, one-tap prefill. Uses the same endpoint, just pre-populates the search/add flow.
- Add guest — prompt for display name, clearly labels the player "guest" with a badge. Explain in helper text: guest players don't receive email notifications for charges.
- Conflict warnings — if a player is also selected in another matchday on the same date, inline warning.

### Confirm team + roles

Same page, stepper:

1. **Statuses** — for each selected player, pick `playing` / `dropped_out` / `no_show`. Default all to `playing` at time of picking. Playing list sorted to top.
2. **Roles** — tap a playing player to toggle captain (crown) or keeper (gloves). Exactly one of each; enforce client-side.
3. **Review** — "You're about to confirm X players. Fees will be charged: {list of expected fees per category}." Confirm button.

Endpoints: `POST /matchday/:id/confirm` (step 1 submission), `PUT /matchday/:id/roles` (step 2 submission). Two calls, not one — matches the existing API. Show progress across the two.

Post-confirm: bounce to the matchday detail view with a banner: "Team confirmed. Share team news on socials? Ask an admin to generate the image." (Image gen is admin-only now.)

### Captain "match day" view

Route: `/matchday/:id/live` (separate route so the URL can be bookmarked / push-notified later).

Visibility: only to `matchday_player.is_captain` user for this match, or any official of the team.

Layout:

- **Top banner.** Opposition, start time, ground. Toss / choice indicator field (optional — parked if Play-Cricket doesn't give us).
- **Squad with fee toggles.** Each playing player row shows: name, captain/keeper markers, paid toggle, payment method dropdown (cash / bank / card). Tapping the toggle calls `POST /matchday/:id/players/:playerId/mark-paid`. Optimistic.
- **FAB: add expense.** Bottom sheet: type (umpire / scorer / match ball / teas / misc), amount (£), description (optional), photo (captures from camera or picks from library, uploads base64 to `POST /matchday/:id/expenses`).
- **Finish match button.** Opens confirm sheet showing: X playing players unpaid (will be charged post-match), Y draft expenses (will be auto-submitted), Z emails to send. Result picker (W / L / D / T / A / C / N). Commit → `POST /matchday/:id/finish`.
- **Post-finish state.** Same screen, read-only, shows the submitted result + links to "record result scorecard" (out of scope — Play-Cricket does it).

### Expenses — official authoring

Route: `/expenses/mine`.

List view of matchdays I've recorded expenses for, with inline expense status (draft / submitted / approved / reimbursed).

Record flow reuses the bottom sheet from captain view. From a confirmed matchday detail page, officials can add/update/delete draft expenses before the matchday is finished.

## Acceptance criteria

- [ ] A manager can create an availability request for a 4-week window, trigger notifications, and see responses arrive on the detail view
- [ ] A manager can pick a team, including adding a guest, and confirm without leaving one screen flow
- [ ] Confirmation pre-generates a preview of fee charges and shows it to the official before committing
- [ ] A captain, signed in on their phone, sees the match-day view at the top of home
- [ ] Mark-paid is one tap
- [ ] Expenses can be recorded pitch-side with a receipt photo taken from the device camera
- [ ] Finish match shows a summary and emits the expected charges/emails
- [ ] Works on a Samsung mid-range device in Chrome and an iPhone in Safari with intermittent 4G

## Risks / gotchas

- **`is_captain` drives the pinned match-day card on home**, but is set during the "roles" step after confirm. If a manager confirms the team but forgets the roles step, the captain gets nothing. Phase 2's dashboard should fall back to "you're an official of this team, here's a match today" as well.
- **Receipt photos are base64-encoded** — can be megabytes. Client-side resize to ~1600px longest edge before upload or the payload kills 4G users.
- **Transactional confirm.** `POST /matchday/:id/confirm` creates charges within a DB transaction. If it fails partway, we get inconsistent state. Current service looks transactional (service.ts around line 629) — verify by re-reading before shipping phase 3.
- **The `finish` endpoint is idempotent on result change** (see inventory §7.3) but _not_ on "I finished this but forgot to mark someone paid" — once charges are created, marking paid afterwards works via `mark-paid`, so this is fine. Document in UI.
- **Availability → team-selection bridge.** `POST /availability/requests/:id/dates/:date/confirm` creates fixture IDs per the inventory. Need to check whether those translate into matchday rows directly, or whether team selection remains a separate step. Inspect before implementing the "start squad from assignments" shortcut.

## Estimate

2 engineers in parallel, ~2 weeks. Lots of UI density but the endpoints are all there.
