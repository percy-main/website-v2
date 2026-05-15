# Design prompt — Admin / treasurer flows

**Prerequisite.** Shell + player + official design prompts have run. All primitives, components, and layout conventions are established.

## Context

Admin flows are narrow in surface but important. The treasurer sits down once a week, goes through submitted expenses, approves or rejects them, and later reimburses approved ones. Separately, the admin generates team news images to post to socials.

Admin usage is almost always **desktop**. Optimise for desktop — mobile can be good enough.

## Flows to design

### Flow 1 — Expense approvals inbox

**Entry:** Approvals tab (admin only). Badge the tab with the count of pending submissions.

Route: `/admin/expenses`

Tab bar at top:

- **Pending** (default) — submitted, awaiting approve/reject
- **Reimbursement queue** — approved, awaiting reimburse
- **History** — resolved

**Pending tab:**

Table / list with columns (desktop):

- Receipt thumbnail (tap / click to enlarge in a modal, use `img` with `loading="lazy"`)
- Type (umpire fee / match ball / teas / etc) — icon + label
- Amount (right-aligned, prominent)
- Match context: "1st XI vs Tynemouth, 4 May"
- Creator (who submitted)
- Submitted date
- Actions (right side): Approve / Reject (Reject opens reason input inline, not modal — less friction)

Mobile collapses to stacked cards.

Bulk actions:

- Checkbox select
- "Approve selected" primary (with confirm: "Approve 4 expenses?")
- "Reject selected" opens one reason input applied to all

Soft-undo on approve / reject: toast with "Undo" button visible for 5 seconds before the mutation commits client-side.

**Reimbursement queue tab:**

Same shape but showing approved expenses. Primary action per row: "Mark reimbursed" (assumes the treasurer has sent the BACS transfer outside the app). Optional: a "Bank details" expand showing the creator's stored bank info if we have it (parked — members table doesn't have this yet).

Bulk: "Mark all reimbursed" with confirmation.

**History tab:**

Filter bar: status (approved / rejected / reimbursed), team, date range, creator.
Paginated table. No actions, read-only.

### Flow 2 — Team news image generator

**Entry.** From a confirmed matchday's detail page, admin sees "Generate team news image" button (hidden for non-admins).

Route: `/admin/team-news/:matchId` (modal or full page — suggest modal so admin stays in flow)

Form:

- Home / away toggle (default from matchday record)
- Match time input (default from Play-Cricket data if present, else 13:00; HH:MM 24-hour)
- Override text fields (opposition, venue) — optional, use only if Play-Cricket data is wrong

Preview (right half on desktop, below form on mobile):

- Loading spinner while PNG is generated
- Once fetched, show the PNG at display size
- Actions: Download, Copy to clipboard (use `navigator.clipboard.write` with image blob), Regenerate

Empty / error states:

- No players confirmed yet → "You need to confirm the squad before generating" with link back to the confirm page
- Generation failed → "Couldn't generate — try again" with a Retry

Hint text: "Post this to the club Twitter / Facebook / WhatsApp group. Don't forget to @-tag opposition and sponsors." No auto-post in v1.

### Flow 3 — Fee rate admin

Route: `/admin/fee-rates`

Table: team (or "Any") × competition type (or "Any") × member category × amount pence.

Desktop grid, mobile stacked cards. Each row has Edit (pencil) and an info tooltip showing the priority at which this rate applies (team+comp+cat > team+cat > comp+cat > any+cat).

Add rate: floating + button → modal with: team (optional select), competition type (optional select), member category (required), amount in pounds (we store pence but input in pounds — conversion at submit).

Edit rate: same modal, prefilled.

**Careful:** changing rates affects future confirms only (current charges are already created). UI should say so: "Changes apply to matches confirmed after now. Existing charges are unaffected."

### Flow 4 — Settings hub (parent)

Route: `/admin` (no page in and of itself; landing page listing admin sub-areas)

- Approvals → flow 1
- Fee rates → flow 3
- (Future: team officials, member categories — parked)

## Interaction & tone

- **Assume experience.** Admin users know the domain; no hand-holding copy.
- **Don't hide destructive actions, but confirm them.** Approve/reject affect real money; use a 5-second soft-undo.
- **Density over whitespace.** Admin is a tool for getting through a queue — show 10 rows on screen, not 3.
- **Desktop is the primary target**, mobile is acceptable.

## Deliverables

Working React + Tailwind:

- `apps/matchday/src/pages/admin/expenses/*`
- `apps/matchday/src/pages/admin/team-news/[matchId].tsx`
- `apps/matchday/src/pages/admin/fee-rates/*`
- `apps/matchday/src/pages/admin/index.tsx` (hub)

Every state on the `/design` route. Accessibility: tables need proper headers and row-scope, bulk actions need keyboard support, focus management on modals.
