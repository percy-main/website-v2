# Matchday flow - amendments to PLAN.md

Status: **draft, pending review**
Date: 2026-05-16
Owner: @alexyoung

`PLAN.md` is the record of the v1 plan as originally drafted. This file captures the revised flow and the deltas vs. what's currently shipping. Everything below supersedes the equivalent section in `PLAN.md`. Nobody uses the new matchday app yet, so backwards compatibility is not a concern.

## 1. Revised end-to-end flow

1. Official creates an availability request and picks one or more user groups at creation time.
   1. Notifications (email, and push when wired up) fire to members of the selected groups as part of the create call.
   2. Any player can respond via the direct link, regardless of group membership. Their responses surface to officials.
2. Players respond in the app.
3. Official picks a provisional team. On finishing the pick, the UI prompts the official to close the parent availability request.
4. Provisional teams remain changeable up until the post-match wrap.
5. Post-match, the captain runs a single wrap-up flow:
   1. Confirm who actually played. Drop-outs and no-shows recorded here.
   2. Enter the result.
   3. Confirming this step is what creates the match-fee charges. For any player whose resolved fee is null (no matching rate), the captain enters the amount inline.
   4. Captain marks charges paid, picking the payment method (cash / bank / card).
   5. Captain closes the match off.
6. Expenses can be added at any point from matchday creation through to match_date + 5 days. After that the option is hard-closed (no soft override). Existing draft expenses still auto-submit on finish, as today.

## 2. Deltas vs. current code

| Area                           | Current                                                                                                                                                          | New                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Availability create payload    | Optional single `user_group_id` on the request; recipients chosen later via `/notify/preview` + `/notify/send`; filters by `memberCategory` + `membershipStatus` | Multiple user groups selected at creation; notifications fire as part of the create call                                           |
| Direct-link responses          | Anyone with the public link can respond, but non-group responses are filtered out of `getDateDetail` and similar picker queries                                  | Same response gate, but non-group responses are surfaced to officials                                                              |
| Provisional team pick          | `POST /matchday/:id/confirm` flips status `pending → confirmed` AND creates charges in one transaction (`matchday/service.ts:908-1017`)                          | Picking a provisional team is just assignment via `POST /matchday/:id/players`. No status flip, no charges                         |
| Close availability request     | Manual `PATCH /availability/requests/:id status:closed`                                                                                                          | UI prompts the official to close the request once a provisional team is set. Still uses the same PATCH; UI-only change             |
| Add / remove players post-pick | Allowed while `confirmed`, blocked at `finished`                                                                                                                 | Allowed any time before the post-match wrap, regardless of intermediate state                                                      |
| Captain post-match             | Pre-match `confirm` (charges) → pitch-side `mark-paid` → `finish` (auto-submit expenses, fallback charge creation, charge emails)                                | Single post-match wrap: confirm-who-played + result + charges + mark-paid + close. `/confirm` endpoint removed from the public API |
| No-show recording              | At pre-match `confirmTeam` via `playerStatuses`                                                                                                                  | At the post-match wrap step                                                                                                        |
| Per-player fee override        | None. Resolver fails or returns null if no matching `match_fee_rate` row                                                                                         | Captain enters an amount inline at the wrap step for any player whose resolved fee is null. Captain-only power (not admin-only)    |
| Mark-paid                      | Allowed any time after charges exist (post pre-match confirm)                                                                                                    | Same mechanic, but charges now only exist after the post-match wrap                                                                |
| Expense window                 | Only while `matchday.status = 'confirmed'` (`matchday/service.ts:395-402`); auto-submit on finish                                                                | Open from matchday creation through match_date + 5 days. Hard cutoff after that. Auto-submit on finish unchanged                   |

## 3. Schema changes

Small.

1. New `availability_request_group` join table replacing the singular `availability_request.user_group_id` column. Migration steps:
   - Create `availability_request_group (request_id, user_group_id)` with composite PK.
   - Backfill from existing `availability_request.user_group_id` where not null.
   - Drop the column.
2. No matchday-table changes. The `pending` / `confirmed` / `finished` / `cancelled` state machine stays. What changes is _when_ `confirmed` is reached - now as part of the post-match wrap, not the pre-match pick.
3. Optional: `charge.amount_overridden_by` + `charge.amount_override_reason` for audit on captain overrides. Skip in v1 - the existing `charge.created_by` plus the amount column already capture who set it and to what.

## 4. API changes

- `POST /availability/requests` accepts `userGroupIds: string[]` (replacing `userGroupId`). Notifications are dispatched as a side effect of create, not via a second call. Keep `/notify/send` for follow-up nudges and re-sends.
- Drop the public `/notify/preview` endpoint if no other caller relies on it.
- Drop the public `POST /matchday/:id/confirm` endpoint. The work it did - status flip plus charge creation - moves into `finishMatch`. Keep `confirmTeam` as an internal step inside the finish transaction if it simplifies the service.
- `POST /matchday/:id/finish` payload extends to:
  - `playerStatuses` (today this is on the confirm payload).
  - `resultType` (today).
  - `feeOverrides?: { playerId: string; amountPence: number }[]` for the captain override.
- Lift the `status === 'confirmed'` gate on `POST /matchday/:id/players` and `DELETE /matchday/:id/players/:playerId`. Replace with `status !== 'finished' && status !== 'cancelled'`.
- Replace the expense status gate (`matchday/service.ts:395-402`) with a date-window check: reject if `now() > match_date + 5 days` or the matchday is cancelled. Status no longer gates expense creation.
- The picker queries in `availability/service.ts` (`getDateDetail` and friends) drop the user-group filter so direct-link responses from non-group members surface to officials.

## 5. UI changes (matchday app)

Most of the wireframes in the design prompts already fit. The deltas:

- **Availability create** (flow in `DESIGN_PROMPT_official.md`, step 3). Replace the `memberCategory` + `membershipStatus` filter UI with a multi-select user-group picker. Notifications fire on submit; no second "send notifications" screen.
- **Squad picker** (flow 5 in `DESIGN_PROMPT_official.md`). Drop the "Continue → Confirm" step at the end. After picking, surface a prompt: "Close availability request?" with a single confirm action. The captain/keeper role assignment folds into the squad picker itself (crown / gloves icons inline), removing the separate roles stepper from flow 6.
- **Confirm stepper** (`apps/matchday/src/pages/matchday/[id]/confirm.tsx` per the v1 plan). Cut entirely - the team-confirm + result + charges + mark-paid all happen in the post-match wrap.
- **Post-match wrap** (replaces `live.tsx` in the v1 design). Same single-screen layout as the captain "live view" wireframe in `DESIGN_PROMPT_official.md`, but reframed as a post-match step rather than pitch-side:
  - Player list with played / dropped-out / no-show selectors.
  - Result picker.
  - Confirm button - this is the action that creates charges. Inline amount input appears beside any player whose resolved fee is null.
  - Once confirm has fired, the row toggles become paid / unpaid + payment method dropdown (today's `mark-paid` flow).
  - Close-match button at the bottom.
- **Expenses entry**. Available from the matchday detail page from creation through match_date + 5 days. The Floating Action Button in the captain wrap-up wireframe stays, but appears on the matchday detail screen too, not only post-match. Hidden / disabled after the 5-day cutoff.

## 6. Suggested order of execution

1. Schema: `availability_request_group` join table; backfill; drop the old column. (Half-day.)
2. API - availability create collapse: multi-group payload; notifications dispatched on create; drop `/notify/preview` if unused. (2-3 days incl. tests.)
3. API - matchday flow shift: rip charge-creation out of `confirmTeam`; fold it into `finishMatch`; accept `playerStatuses` + `feeOverrides` on finish; drop the public `/confirm`; lift player-mutation status gate. (3-4 days; riskiest piece. Get integration tests around the new finish behaviour first.)
4. API - expense window: replace status gate with date-window gate. (Half-day.)
5. Matchday UI - availability create: user-group picker, single submit. (1 day.)
6. Matchday UI - squad picker: fold roles in, drop confirm stepper, add close-request prompt. (2-3 days.)
7. Matchday UI - post-match wrap: rebuild as a single screen with confirm-played + result + charges + override + mark-paid + close. (3-4 days.)
8. Cutover: delete the main-site `/matchday`, `/official`, `/official/availability` pages in the same PR as step 3. Once `confirmTeam` no longer raises charges, leaving the old pages live is unsafe.

## 7. Answered design decisions

- **Per-player fee override**: captain power, not admin-only.
- **Closing the availability request when a team is picked**: prompt, not automatic.
- **Expense 5-day window**: hard cutoff. No soft / admin override.
- **PLAN.md**: left untouched as the record of the v1 plan. This file (`amendments.md`) carries the revised flow.

## 8. Gaps in what was built vs. what the prompts called for

The app shipped, but several screens are thinner than the design prompts anticipated. The fixture-detail screen is the worst offender and the one most visible to officials.

### 8.1 Fixture detail (`apps/matchday/src/pages/fixture-detail.tsx`)

Today this screen is read-only for everyone. It shows date, opposition, ground, status, the probable / confirmed team, and a "Get directions" button. There is no role-aware branching - an official sees the same screen as a player.

`DESIGN_PROMPT_player.md` flow 3 called for:

- "If user is an official of the team: 'Manage this match →'" - missing.
- "If confirmed and user is named: 'You're on the team. View team sheet →'" - missing.

For the amended flow, the official view of this screen should be the operational hub for the fixture. Concretely, when the signed-in user is an official of the team, add:

- **Manage squad** action - links to `/matchday/:matchdayId/edit` if a matchday exists for this fixture; otherwise a "Pick team" action that creates the matchday record and lands on the edit screen. Today this only exists from the Squad tab.
- **Availability summary** for the fixture date - counts of available / unavailable / no-response, with a link into the per-date picker (`/official/availability/:id/date/:date`). The official should not have to bounce out to the Availability tab to see who's around.
- **Close availability request prompt** - per the amended flow, once the team is provisional, surface a one-tap prompt to close the parent availability request from this screen.
- **Expenses** - link / inline list of expenses recorded against this matchday so far, plus an "Add expense" action. The 5-day cutoff after match date governs whether the action is enabled.
- **Post-match wrap action** - once the match date is in the past, the primary action becomes "Wrap match up" (the post-match flow from §5: confirm played, result, charges, mark paid, close).
- **Generate team news image** - admin-only action, visible only on a confirmed matchday before match date.
- **"You're on the team"** badge in the squad list for the user's own row (already in the team-sheet view, missing here).

### 8.2 Squad tab - no way to reach a created matchday

From the Squad tab (`apps/matchday/src/pages/squad.tsx`), the only entry points into an existing matchday are:

- The pinned "Today / next match" link, which only appears for matchdays that are already `confirmed`.
- The "Needs attention" link for the oldest past-unfinished match.

A team card shows "4 upcoming" but tapping it opens the "New matchday" form, not a list of the team's existing matchdays. There's no list view of matchdays for a team, and no link from a fixture that already has a matchday into that matchday.

The "New matchday" screen (`apps/matchday/src/pages/squad-new.tsx`) does render pending matchdays inline alongside fixtures that haven't been started, with a "pending →" pill suggesting they're clickable - but the button is disabled when `alreadyCreated` is true:

- `squad-new.tsx:135` - `disabled={alreadyCreated || create.isPending}` blocks the click.
- `squad-new.tsx:137` - the onClick already branches on `alreadyCreated` to `navigate(/matchday/:id/edit)`. That branch is unreachable because of the disabled prop.

Fix is one line - drop `alreadyCreated` from the disabled expression. Separately, the Squad team card should grow a "Matchdays" link or inline list of existing ones, so officials don't have to go through "New matchday" to find them.

### 8.3 Sign-in redirect lands on a malformed URL

Reproduces in dev (probably prod too). Hitting an unauthenticated route on the matchday app sends the user to a path-style URL on the main site rather than a query-string one:

    http://localhost:5173/auth/login/http:/localhost:5175/

instead of the expected:

    http://localhost:5173/auth/login?returnTo=http%3A%2F%2Flocalhost%3A5175%2F

The matchday code that builds the sign-in URL looks correct - `apps/matchday/src/lib/main-site.ts:22-24` does `?returnTo=${encodeURIComponent(returnTo)}`, and only one caller (`apps/matchday/src/components/require-auth.tsx:70`) hits it. There is no code on either side that builds a `/auth/login/<path>` form. The single-slash `http:/` in the address bar suggests the URL got decoded once and then the browser collapsed `//` to `/`, but the source of that decode hasn't been traced.

Worth a full network-trace pass to find which redirect produces the malformed URL.

### 8.4 Search inputs jitter without debouncing

Search inputs in the matchday app fire a network request on every keystroke. The matchday squad picker at `apps/matchday/src/pages/matchday-edit.tsx:35-44` queries `/api/matchday/members/search` whenever the `search` state changes (only the `length >= 2` floor is in place). On a slow connection or fast typist this jitters - in-flight requests for "Sm", "Smi", "Smit", "Smith" arrive out of order and the result list flickers.

Fix: debounce the search state by ~250-300ms before it becomes the query key. A small `useDebouncedValue` hook is the right shape - reuse anywhere a free-text input drives a query.

Other places to apply the same hook once we have it:

- `apps/matchday/src/pages/matchday-edit.tsx:120-128` (member search - the screen above).
- Any future search field in availability management, expenses history, fee-rate admin.

### 8.5 Other screens worth re-checking against the prompts

Not investigated in depth yet, flagging for review:

- **Home dashboard** - the prompts call for separate cards (availability awaiting, team sheets, fees, captain match-day pin, pending approvals for admins, upcoming, recent results). Worth a pass to see which are wired to data vs. stubbed.
- **Captain match-day view** (`matchday-live.tsx`) - per the amendment this changes purpose (post-match wrap rather than pitch-side live), so it needs a rebuild anyway, but worth checking the existing build before rebuilding.
- **Availability per-date picker** (`official-availability-date.tsx`) - the prompt asked for three-column desktop / three-tab mobile, drag-or-tap assign, conflict warnings. Worth verifying density and assignment mechanics hold up.

## 9. Open questions

- **Cancelled matchdays**: today, cancel is blocked if any active charges exist. With charges now created later, cancel becomes simpler - a cancelled match never raises charges. Worth confirming there's no case where the match is half-confirmed (team picked but match called off).
- **Charge emails on the new finish**: today's `finishMatch` sends `ChargeNotification` emails on first finish. With the new flow that's still the right trigger - confirm-and-create-charges-and-notify all happen together at post-match wrap.
- **What happens if the captain forgets to wrap up**: today a match left at `confirmed` has charges raised but no result. Under the new flow it has no charges either. We need a chase mechanism (e.g. an admin "wrap up this match" button) for matches > N days past their fixture date that have never been wrapped.
