# Phase 4 — Admin experience

**Goal.** An admin / treasurer can review and settle expenses efficiently, generate the team news image, and manage match-fee rates — all in the matchday app rather than the main-site admin panel.

## Deliverables

### Additional nav for admins

Inject into the tab bar:

- **Approvals** — expense inbox (count badge if pending > 0)
- **Settings** — (admin-only section) fee rates + team/role admin

### Expense approval inbox

Route: `/admin/expenses` with tabs:

- **Pending** (default) — `GET /matchday/expenses/pending?status=submitted`
- **Approved (awaiting reimbursement)** — `GET /matchday/expenses/pending?status=approved`
- **History** — paginated list of all resolved expenses, filterable by team, date range, status

Expense row shows: thumbnail of receipt (click to zoom), type, amount, opposition + date, creator, submitted date.

Actions per row:

- **Approve** (`POST /matchday/expenses/:id/approve`) — one tap
- **Reject** (`POST /matchday/expenses/:id/reject`) — opens reason sheet (required)
- **Reimburse** (`POST /matchday/expenses/:id/reimburse`) — visible only on approved rows

Bulk action: select multiple approved → "Reimburse all" (iterates one POST per row — the API doesn't batch; acceptable at current volume).

After approval/reimbursement, optimistic update removes the row from the list. Soft undo toast for 5 seconds before the mutation is "committed" client-side (avoids accidental approvals).

### Team news image generator

Route: `/admin/team-news/:matchId`

**Permission change from today:** `GET /matchday/:matchId/team-news-image` preHandler moves from `officialRole` to `adminRole`. One-line backend change, documented here so it lands in the same PR as the new admin UI.

UX:

- Navigate from a matchday detail view → "Generate team news image" (admin-only button)
- Form: home/away toggle (default derived from the matchday record), match time input (default from Play-Cricket if available, else 13:00), optional override of opposition/venue text
- "Generate" → fetches PNG → displays in a modal with a download button and a "Copy to clipboard" button (uses `navigator.clipboard.write` with image blob — works on Chrome, Safari 16.4+)
- Hint text: "Post this to the club Twitter / Facebook / WhatsApp. Don't forget to tag @percymaincc." (manual posting, no auto-post in v1)

### Match-fee rate admin

Route: `/admin/fee-rates`

Replaces `apps/web/src/pages/admin/match-fees-tab.tsx`.

List view grouped by: team + competition type + member category, showing the current amount in pence. Rate lookup priority (team+comp+cat → team+cat → comp+cat → any+cat) visualised — e.g. an info tooltip on each row showing which rate would apply for a given match shape.

Edit is a full-form modal; no inline edit (rates are rarely changed and the ripple effect is high).

Endpoint: needs a CRUD endpoint on `match_fee_rate`. Check whether one exists; if not, this is a small backend addition (trivial schemas, pattern established in other admin features).

### Charges admin (parked)

Replaces `apps/web/src/pages/admin/charges-tab.tsx` — but charges administration (view all members' balances, adjustments, refunds) cross-cuts membership, donations, and matchday. **Deferred to a later phase** unless the treasurer flags it as essential for v1. The existing main-site tab stays until then (won't be deleted in phase 6 cutover).

## Acceptance criteria

- [ ] Admin receives a homepage nudge ("3 expenses waiting approval") when pending > 0
- [ ] Approvals inbox shows receipts clearly enough to review without opening a modal
- [ ] Reject requires a reason; reason is recorded and surfaced on the creator's expense view
- [ ] Reimburse transition is visible and auditable (the reimbursed_by user name appears in the history)
- [ ] Team news image generator works end-to-end, produces the same PNG shape as today
- [ ] Fee rate admin covers create / edit; delete parked unless needed
- [ ] No regressions in existing admin endpoints

## Risks / gotchas

- **Image generation moved to admin-only.** Confirm with product that this is the right restriction — some captains might _want_ to generate their own. Counter-argument stays in PLAN §5.4: the image represents the club publicly, and today officials-on-junior-teams could generate senior team news. Admin-only is tighter but simpler than per-team permission.
- **Reject without reason is a footgun.** The existing API requires a reason via schema validation, but if client-side we let them submit empty we get a 400 they don't understand. Enforce client-side.
- **The existing admin tabs still work** during phases 1–4. Don't remove them until phase 6. The matchday app provides the _new_ location, not the _only_ location, during parallel rollout.
- **Bulk reimburse.** If the treasurer has 20 pending, sequential POSTs take 20× round-trips. Acceptable volume for now; if it becomes a pain, add a batch endpoint rather than firing 20 parallel requests (that risks partial success).

## Estimate

1 engineer, ~1 week. Simpler than phase 3 in terms of surface area.
