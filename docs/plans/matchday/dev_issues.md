# Matchday amendments - dev issues log

Live log of decisions, blockers, and things needing review while working through `amendments.md`. Each entry is dated; oldest at the top.

Branch: `matchday-amendments`.

---

## 2026-05-16

Started work on the branch. Plan is to follow the order in `amendments.md` section 6:

1. Schema: `availability_request_group` join table
2. API: availability create collapse (multi-group + notify on create)
3. API: matchday flow shift (charges move to finish)
4. API: expense window (date-based, not status-based)
5. UI: availability create (multi-group picker)
6. UI: squad picker (fold roles, drop confirm stepper, prompt close)
7. UI: post-match wrap screen
8. Cutover: delete the main-site `/matchday`, `/official`, `/official/availability` pages

Plus bug fixes from section 8:

- 8.2 Squad-new disabled button (one-line; pre-existing WIP)
- 8.4 Search debouncing
- 8.3 Sign-in redirect malformed URL
- 8.1 Fixture detail official actions

### Follow-up: §8.3 sign-in redirect bug needs a network trace

Code inspection of apps/matchday/src/lib/main-site.ts:22-24 and the only
caller in components/require-auth.tsx looks correct -
`?returnTo=${encodeURIComponent(...)}`. The malformed
`/auth/login/http:/localhost:5175/` URL must be introduced downstream
(service worker fetch handler? main-site redirect? better-auth flow?).
Needs a browser session to bisect via the network tab; deferred.

### Follow-up: "Close availability request?" prompt on squad picker

Section §5 calls for a prompt offered on the squad picker after a team
has been picked. To wire this up I need to thread the parent
availability_request id through to the matchday detail (matchday only
has play_cricket_match_id today, not an availability_request_id). Two
options on review: extend the matchday detail with a derived
parentRequestId (cheapest), or persist matchday.availability_request_id
when the matchday is created from confirmDate. Left as a follow-up;
flow still works without it - officials can close the request from
/official/availability/:id manually.

### Follow-up: fee-override UX granularity on wrap screen

The wrap-up bottom sheet currently relies on the API's
"Missing fee for: NAME1, NAME2" 400 response to know which players need
an inline donation amount. That works but assumes name uniqueness in the
squad. Cleaner: extend GET /api/matchday/:id to include the resolved
match-fee per playing player, and pre-render the inline amount input
for any null-fee row.

### Blocker: 1Password SSH signing agent stopped responding mid-session

Two commits got far enough that all my staged work for "feat(api): shift
charges + status flip..." was ready, but `git commit` started returning
`error: 1Password: failed to fill whole buffer` / `agent returned an
error`. CLAUDE.md memory + repo policy says never to skip signing
without explicit approval, so I'm leaving the commit hung and continuing
work in the working tree. If 1Password unlocks, the commit will go
through on a retry. If not, this is the first thing to fix on return.

### Decision: at least one user group required on availability create

Section 2 says "Multiple user groups selected at creation time" (plural).
The new flow drops the `memberCategory` + `membershipStatus` filters, so
the selected groups define the recipients. There is no implicit
club-wide / unscoped path now - if you want to ask the whole club, add
the club to a "Whole club" user group and select it. I'm enforcing `min(1)`
on `userGroupIds` in the create payload as a result. Worth a sanity check
when reviewing.
