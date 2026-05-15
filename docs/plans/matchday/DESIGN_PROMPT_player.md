# Design prompt — Player flows

**Prerequisite.** The shell prompt (`DESIGN_PROMPT.md`) must have been run first. You have: `AppShell`, `BottomTabBar`, `DesktopSideNav`, home cards, status pill system, player row primitive, design tokens (navy primary, red accent, green success, amber warning). Reuse all of that — don't redesign.

## Context

Designing the player-facing flows for `matchday.percymain.org`. The player is an adult amateur cricketer (20–60), using their phone during the week to answer availability, check if they've been picked, and see any outstanding match fees. They do this between other things — short sessions, fast completion.

**Constraints from the plan:**

- No player-side "confirmation" step — responding to availability _is_ their commitment
- Players don't pay in the matchday app — they view fees, but the pay button links out to `percymain.org/members/charges` (main-site Stripe flow)
- Team sheets are visible to any signed-in user (simple; we can tighten later)

## Flows to design

### Flow 1 — Availability response

**Entry points:**

- Home card: "You have N dates to confirm" → this flow
- Nav: Fees tab has no separate entry; Home tab surfaces it

**Design:**

Route: `/availability/respond`

Full-screen stepper. One date per screen. Advance by tapping Available or Unavailable — not swipe (swipes are fast but easy to mis-fire).

```
Screen composition (mobile, top to bottom):

[back arrow]  [progress: 2 of 4]          [skip all →]

Saturday 11 May
2nd XI vs Backworth 2nd (League)
1st XI vs Tynemouth (away, Cup)

[ big green: Available ]
[ big red:   Unavailable ]

Optional note:
[  text input, placeholder: free after 1pm  ]

[ Apply same to all 2 remaining ]       ← subtle link
```

- Progress visible at all times (stepper dot row at top or "2 of 4" text)
- Both fixtures on the same date shown together — player answers for the _day_, not per fixture
- After tapping, brief success animation (subtle — checkmark fade + advance), no explicit Next button
- Optional note appears after status is chosen; typed, optional submit via thumb
- "Apply same to all remaining" visible from screen 1 — power-user affordance (holidays)
- Final screen: "All done. See you on the pitch." — primary action back to Home

**Edge cases to design:**

- No active requests → "You're all caught up" placeholder (reuse Home empty-state style)
- User already responded to some dates → those pre-populated but editable (toggle on detail screen)
- Request closed mid-flow → show "This request has closed" card on the date, can't submit
- Offline → optimistic save with inline "will sync" badge on the date card

### Flow 2 — Fixtures list

**Entry:** Fixtures tab

Route: `/fixtures`

Public-in-spirit view: upcoming and recent senior fixtures (not admin data). Use this as the browse / orient surface.

**Design:**

- Section headings by week: "This week", "Next week", "Later this month"
- Each row: date (bold), team (1st/2nd XI), opposition, home/away, competition
- Result badge if played (W/L/D/T + score if available)
- Tap a row → fixture detail

Filter chip row at top: All / 1st XI / 2nd XI

### Flow 3 — Fixture detail

Route: `/fixture/:matchId`

- Opposition, date, ground (home/away), competition, start time
- If played: scoreline, link to Play-Cricket scorecard (external)
- If confirmed and user is named: "You're on the team. View team sheet →"
- If user is an official of the team: "Manage this match →"
- Map / directions to ground (reuse Google Maps deep link, don't embed)

### Flow 4 — Team sheet view

Route: `/matchday/:matchdayId`

This is the money view for a selected player: am I in, who's playing, where are we going?

**Design:**

```
Header:
  1st XI vs Tynemouth
  Sat 18 May • 13:00 • Home (Percy Main)

Squad (11 names, order matters — batting order is a separate convention, don't claim to know):
  [crown] Stuart Browne (c)         [YOU]
          Mark Smith
  [glove] Gareth Holroyd (wk)
          ... 8 more ...

Drop-outs (collapsible, shown collapsed by default):
  Alex Young  "holiday"
  ...

Footer:
  Share team sheet [copy link]  (not the PNG image — that's admin)
```

- User's own row highlighted with "YOU" badge
- Captain row pinned with crown, keeper with gloves
- Drop-outs collapsed by default — clutter otherwise
- No fee info here (player sees their own fees on /fees, not mixed in with team sheet)
- Share link — copy-to-clipboard of the matchday URL, simple

### Flow 5 — Fees view

**Entry:** Fees tab, or home "Outstanding fees" card

Route: `/fees`

**Design:**

- Top: total outstanding, big number, primary "Pay on main site" button (opens `percymain.org/members/charges` in new tab)
- Below: list of outstanding charges — date, opposition, amount. Tap for breakdown if needed
- Tab: History (paid charges, same shape, muted)
- Empty state for both tabs

Copy guidance: currently called "match fee" in the API. Use "Match fee" in UI. Note: per a future treasurer request, wording may change to "donation" — design so a single constant swap covers it.

## Interaction & tone

- **Gentle, not pushy.** The app shouldn't nag about unanswered availability. One card on home, no red dot on the tab, no push asks (that's opt-in later).
- **Confirming an action feels final.** Taps that save data get a micro-animation (subtle checkmark) + toast "Saved".
- **Errors are human.** "Couldn't save — try again" not "Request failed with status 500".

## Deliverables

Working React + Tailwind for each route:

- `apps/matchday/src/pages/availability-respond/*`
- `apps/matchday/src/pages/fixtures/*`
- `apps/matchday/src/pages/matchday/[id].tsx`
- `apps/matchday/src/pages/fees/*`

Demonstrate on the `/design` route from the shell prompt with every state (empty, loading, error, populated, offline).
