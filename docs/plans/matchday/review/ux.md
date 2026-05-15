# UX Review — Matchday PWA redevelopment

**Reviewer:** Senior UX Researcher
**Scope:** `PLAN.md` §5, `DESIGN_PROMPT.md`, `DESIGN_PROMPT_player.md`, `DESIGN_PROMPT_official.md`, `DESIGN_PROMPT_admin.md`
**Date:** 2026-04-23

## TL;DR

The plan is coherent, honest about constraints, and rightly prioritises utility over polish. Biggest concerns are: (1) the "captain match-day view" (`DESIGN_PROMPT_official.md` Flow 7) is mis-framed — cash settlement at Percy Main almost always happens in the bar afterwards, not pitch-side, which changes what must be one-handed-windy-glove-friendly vs. what merely needs to be fast-in-the-pub; (2) the per-date availability picker (Flow 3) is overloaded for a 375 px screen — three tabs plus assignment chevrons plus a right-rail of per-fixture assignments plus long-press overrides is too many concurrent affordances; (3) drag-to-reorder for batting order and squad picker has no keyboard/screen-reader equivalent called out; (4) the one-date-per-screen availability stepper is probably wrong for this specific use-case — a single scrollable list is faster, gives context, and suits the "I'll answer six weeks in one sitting" pattern these users actually have. With those fixed, this ships well. Validation can be done cheaply with 5 users across 2 rounds — no UX team needed.

## Flow-by-flow, worst first

### 1. Captain match-day live view (`DESIGN_PROMPT_official.md` Flow 7) — framing is off

Your own PLAN.md §3 says captains open the app "pitch-side before and after a match" and "windy, one-handed, spotty 4G". But the **mark-paid + payment-method dropdown + expense FAB + result picker + Finish** combo is almost certainly used _after the match, in the pub_, not between overs. Cash changes hands at the end. Captains don't carry out per-ball admin.

**Implication:** the design should split into two modes on the same route:

- **Pre/during match (lightweight):** opposition, start time, ground, squad read-only, drop-out/no-show status edits, expense quick-add for on-the-day costs (umpire fee, match ball, teas) — genuinely needs one-handed glove-friendly UX.
- **Post-match settlement (normal ergonomics):** mark-paid per player, payment method, result, finish. This happens indoors. Full attention. Normal tap targets are fine.

Bundling them in one "huge tap targets for cold hands" screen optimises the wrong moment. The current design (Flow 7 diagram) has a Finish button permanently at the bottom of the same screen as mark-paid — that's correct if you accept the screen is really a post-match settlement screen that also shows live info. Rename it in copy from "Match day" (implies live) to something more honest — "Match day admin" or just the match title with a subtle "In progress / Settle up" section pill.

Also: **amount due per player is wrong for cricket economics.** Fees vary (adult / student / colt categories, see `DESIGN_PROMPT_official.md` Flow 6 Step 3). The row shows "£5" hard — make sure the design accommodates "£3", "£5", "£0 (paid via standing order)" without breaking density.

### 2. Per-date availability picker, official (`DESIGN_PROMPT_official.md` Flow 3)

Three mobile tabs is workable; the three **desktop** columns are fine. The problem is **layering**: you have

- three columns of players
- assignment chevrons per row
- a right-rail showing "9 of 11 assigned" per fixture
- long-press override with reason input
- pinned assigned players at top with team colour
- "Use as starting squad" action top-right

That's four concurrent interaction models for one screen. **Recommendation:** move "current assignments per fixture" to a collapsible bottom sheet on mobile (peek showing "1st XI 9/11, 2nd XI 5/11"), and drop the right-rail on desktop in favour of a fixture selector chip row at the top — clicking a fixture chip filters the picker to its assignments.

### 3. Availability player response — stepper vs. list (`DESIGN_PROMPT_player.md` Flow 1)

You've explicitly rejected Tinder-swipe (correct). But a **one-date-per-screen stepper** is the wrong other extreme for this task. Evidence:

- Users answer 4–8 dates in one sitting (availability windows are multi-week)
- They need to see the shape of the ask to plan ("am I free that Saturday? Let me check...")
- "Apply to all remaining" presumes they've seen all the dates — they haven't; they're on screen 2 of 4

**Recommendation:** single scrollable list, one row per date, available/unavailable toggle inline, sticky "Submit all" button at the bottom with a running "3 of 4 answered" counter. Keep the optional note as an expand-on-tap. Simpler, faster, matches how people fill in calendars. This is also more accessible (one page for a screen-reader, one form to submit).

If you want to preserve the stepper for "one date and you're done" context (a single-date chase email), branch on count: 1–2 dates stepper, 3+ list.

### 4. Confirm team + set roles (`DESIGN_PROMPT_official.md` Flow 6)

Three-step stepper for statuses → roles → review is reasonable, but **step 1 drag-to-reorder (batting order)** is gestural-only. Add:

- keyboard "move up / move down" buttons visible on focus
- ARIA live region announcing reorders
- touch-reorder that works with VoiceOver / TalkBack

Also, the "destructive tone" confirm button copy "This will create charges and cannot be undone" is slightly off — charges _can_ be cancelled/adjusted by a treasurer. Soften to "This confirms the team and creates match fees. Players will be notified."

### 5. Admin expense approvals (`DESIGN_PROMPT_admin.md` Flow 1)

Solid. Two notes:

- **Soft-undo toast on approve/reject** is good UX, but for **reimburse** (which maps to "I have actually sent a BACS transfer") the toast should probably not apply — that's recording an external fact, not a reversible UI action. Reject the soft-undo there; use a small confirm instead.
- **Bulk reject with one reason** is risky. Rejection reasons are usually per-expense (wrong receipt, amount mismatch, duplicate). Better: bulk-select only supports bulk-approve; rejections stay per-row.

### 6. Admin team-news image (`DESIGN_PROMPT_admin.md` Flow 2)

Fine. The `PLAN.md` §11 flags the role-tightening from official → admin as a product decision — that still needs confirming with the treasurer / chair, not just shipped. Add a visible note in the deliverable asking for sign-off.

## Accessibility gaps — must address now, not "later polish"

1. **Status pills relying on colour.** `DESIGN_PROMPT.md` calls out green=available, red=unavailable, amber=warning. All three are the classic colourblind failure set. Every pill **must** carry a text label _and_ a shape/icon. Don't rely on the word alone either — an 8 pt-colourblind user reading in sun on a £200 Android needs redundancy. Specify this in the primitives component.
2. **Drag-to-reorder (Flows 3, 6).** No keyboard/SR equivalent mentioned. Use `@dnd-kit` with its keyboard sensor; add explicit up/down buttons visible on focus. Write this into the design prompt now.
3. **Long-press override (Flow 3).** Long-press has no discoverability and no keyboard equivalent. Replace with a visible "..." menu button per row, or right-click on desktop + hold-to-reveal on mobile _with a visible affordance_.
4. **"Apply same to all remaining"** in the stepper is invisible on screen 1 unless the user scrolls — make it a persistent footer, and announce the count to screen readers.
5. **Target sizes.** 44pt minimum is called out in `DESIGN_PROMPT.md` — good. But the mark-paid circle (`DESIGN_PROMPT_official.md` Flow 7) sits next to a payment-method dropdown on the same row — specify the minimum horizontal gap (8 pt) to prevent mis-taps. Glove-friendly implies 48–56 pt for the primary action.
6. **Dark mode.** Called for from day one — **keep it**. It's not marketing polish here; a captain on a sunny 3pm at Percy Main Cricket Club on a phone in bright sun needs max-contrast, and a player checking the team sheet from bed at 11 pm wants dark. System-respecting is correct. However, the "dark surface for captain match day" overlay (`DESIGN_PROMPT.md` colour roles) is _additional_ to system dark mode — make sure outdoor-bright-sun does not trigger a dark surface that becomes unreadable.
7. **Language on stepper progress.** "2 of 4" needs `aria-live="polite"` announcement on advance.

## Copy / tone flags

- "See you on the pitch." (availability completion, `DESIGN_PROMPT_player.md` Flow 1 final screen) — **pitch** in UK cricket is specifically the 22-yard strip, not the ground. Amateur cricketers will notice. Use "See you Saturday." or "All sorted — thanks."
- "You're all caught up" (empty state) — fine but American-coded; "Nothing to respond to" or "You're up to date" is more natural.
- "Don't forget to @-tag opposition and sponsors." (team news hint, `DESIGN_PROMPT_admin.md` Flow 2) — **Percy Main doesn't have sponsors in the corporate-tagging sense**. Remove "sponsors", keep opposition.
- "This will create charges and cannot be undone." (confirm, Flow 6) — overstated (see above).
- "Match day admin" vs "Match day" — rename as noted in Flow 7.
- "Approve 4 expenses?" bulk confirm is fine.
- "Matchday" (one word) vs "Match day" (two words) — inconsistent across files. `PLAN.md` uses both. Pick one for the UI (I'd suggest "Matchday" the noun, "match day" the adverbial phrase) and enforce in a copy doc.
- Avoid: "Let's get you sorted", "Great job!", any exclamation marks outside errors. `DESIGN_PROMPT.md` already guards against this — keep the guard.
- "fee" → "donation" is noted in `PLAN.md` and `DESIGN_PROMPT_player.md` Flow 5 — good, just make sure it's a single tokenised string.

## Contentious design choices — my recommendations

| Choice                                        | In plan                            | Recommendation                                                                                                                                    |
| --------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-date-per-screen availability stepper      | `DESIGN_PROMPT_player.md` Flow 1   | **Switch to scrollable list** for 3+ dates; stepper only for 1–2.                                                                                 |
| Captain match-day as single pitch-side screen | `DESIGN_PROMPT_official.md` Flow 7 | **Split framing** — acknowledge most of it is a post-match/in-pub surface; reserve pitch-side ergonomics only for drop-out and expense quick-add. |
| Drag-to-reorder batting                       | Flow 6 Step 1                      | **Keep, but require keyboard + SR equivalence** written into the design prompt; use @dnd-kit.                                                     |
| Long-press for force-override                 | Flow 3                             | **Replace with visible row menu**. Long-press is undiscoverable and inaccessible.                                                                 |
| Dark mode from day 1                          | `DESIGN_PROMPT.md`                 | **Keep** — genuine need, not polish.                                                                                                              |
| Team news image: admin-only                   | `PLAN.md` §5.4, §11                | **Confirm with treasurer/chair first**; don't assume.                                                                                             |
| Bulk reject with shared reason                | `DESIGN_PROMPT_admin.md` Flow 1    | **Remove**; per-row rejections only.                                                                                                              |
| Soft-undo on reimburse                        | `DESIGN_PROMPT_admin.md` Flow 1    | **Remove on reimburse** (records external action); keep on approve/reject.                                                                        |
| Stepper for confirm (3 steps)                 | Flow 6                             | **Keep.** Role-setting benefits from separation.                                                                                                  |
| Three-column per-date picker on desktop       | Flow 3                             | **Keep** on desktop; **drop right-rail**; use fixture-filter chips instead.                                                                       |

## Research validation plan (minimum viable)

No UX team, one engineer. Goal: catch the expensive mistakes before phase 6 cutover. Budget: ~6 hours of engineer + volunteer time across a season.

### Round 1 — concept check (before phase 2 starts coding)

- **Who.** 1 captain, 1 manager/fixture-sec, 2 regular players. Recruit from the existing Percy Main WhatsApp group. Offer a pint, not money.
- **When.** After `DESIGN_PROMPT.md` shell and one per-audience prompt have been rendered to working components but before the full flows are built — i.e. between phase 1 and phase 2/3.
- **Format.** 20-minute remote call (Zoom / WhatsApp video), share screen of a deployed preview URL (Netlify/Cloudflare Pages).
- **Tasks.**
  1. "Show me how you'd respond if you got an email asking for availability for the next four Saturdays." (catches Flow 1 stepper-vs-list question)
  2. "Imagine it's Saturday afternoon, the match has just finished, three people haven't paid yet. Walk me through what you'd do." (catches Flow 7 framing)
  3. "You're picking a team for next Saturday. Two players said available but one's also on the 2nd XI request." (catches Flow 5 conflict UX)
- **Success criteria.** Each task completed without prompting in under 90 seconds. If 2+ participants stall on the same step → redesign before coding.

### Round 2 — pilot in the wild (parallel rollout stage, per `PLAN.md` §9)

- **Who.** All captains and managers (self-selecting via the club's captain chat). Two match weekends minimum.
- **When.** During the "parallel live" stage of rollout, before flipping the main-site links.
- **Method.** No structured moderation. Instead: (1) an in-app "Something wrong? Tell us" link in the `/me` page emailing the maintainer, (2) weekly 10-minute async check-in in the captains chat asking "anything awkward?", (3) server-side logging of error rates and abandoned flows (availability-started-not-submitted, confirm-started-not-finished).
- **Success criteria for cutover to phase 6.** Two full match weekends with zero captain-initiated "I couldn't finish the match" escalations; availability submission rate ≥ 90% of logged-in eligible members (matches current baseline).

### Round 3 — post-launch lightweight (ongoing)

- Short end-of-season survey (6 questions max, Google Forms) to all members: "Rate the new matchday app 1–5" and four free-text prompts. Annual.
- Specific monitoring for colourblind/accessibility issues — ask on the member form whether anyone had trouble reading status pills. Open-ended.

### What **not** to do

- Don't run a full usability lab study. Volunteer attention budget ≠ research budget.
- Don't do personas workshops — the four in `PLAN.md` §3 are correct and derived from the real club structure.
- Don't A/B test. Sample size (~60 members, with maybe 30 active weekly) is insufficient for significance on most metrics.
