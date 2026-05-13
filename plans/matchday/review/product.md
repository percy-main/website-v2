# Matchday App v1 — Product Review

## Overall verdict

**Ship with changes.** This is a well-scoped, honest plan that correctly identifies the real problem (a 54 KB "god page" that officials hate doing pitch-side) and picks a pragmatic path (new subdomain, same API, parallel rollout). The sequencing is mostly right, the non-goals list is disciplined, and the risks section in PLAN.md §11 shows the author has thought hard about the failure modes. But three things need fixing before execution: (1) phase 1 delivers zero user value and should be compressed or fused with phase 2, (2) rollout is too passive for a 50-person volunteer organisation — "type the URL yourself" is not an adoption strategy, and (3) a handful of real user edge cases (mid-season injury, fee disputes, juniors-up, captain-not-yet-assigned) are glossed. None of these are fatal; all are cheap to address now and expensive to address later.

## Top 3 things to change before execution

### 1. Collapse phase 1 into the start of phase 2

Phase 1 currently delivers a "Hi {name}" greeting behind cross-subdomain auth and nothing else. A volunteer engineer burning a week on infra with no user-visible output is a motivation and momentum risk, and it leaves phase 1 un-testable by real users (there's nothing to test). The Safari ITP verification can happen against a real feature (home dashboard with one card — outstanding charges, say) just as well as against a greeting. Recommendation: keep the phase 1 work items (they're all necessary) but merge the deliverable with "availability response flow + home dashboard skeleton" and ship one useful thing to a handful of players in week 1-2. This also gives a real signal on ITP, install, and perf under real device conditions rather than a synthetic one.

### 2. Active rollout with captain seeding, not passive opt-in

PLAN §9 stage 1 says: "Officials/players opt-in by typing the URL or getting a link from the club's captains chat." This will not produce meaningful adoption data. At 50 seniors and 6 captains, passive opt-in in a volunteer org means 5–10 users try it, the rest stay on the old surface, and you ship phase 6 without having stress-tested anything. Replace with a staged active rollout:

- **Week 1:** 6 captains only — in person / WhatsApp walkthrough, they're the power users whose pain you're solving
- **Week 2:** captains + managers + admin (roughly 10–12 people total) — full official flow exercised on two real fixtures
- **Week 3:** email to all members announcing the new app with a direct link and a one-line "why", pinned in the usual channels
- **Week 4+:** measure, then flip main-site links

This also gives you an email comms plan, which the PLAN currently omits entirely.

### 3. Define success metrics and a go/no-go gate before phase 6

PLAN.md does not say what "success" looks like. Phase 6 cutover decision is a gut call today. Define the KPIs now (see "Proposed v1 success metrics" below) and pre-commit to thresholds so you don't cut over on vibes after two "feels good" weekends.

## Risks the plan underweights

- **Captain assignment gap.** PLAN §11 flags it, phase 3 gotchas reiterate it, but the mitigation ("surface 'you might be captaining'") is deferred to phase 2 as a fallback. In practice, captains get assigned on the day, not during team confirm. This is not an edge case — it is the common case. The "today's match" pinned card needs to work based on `team_official` membership alone, with `is_captain` as an upgrade signal. Lift this out of "risk" and into phase 2 requirements.
- **Offline writes as a feature vs offline writes as a promise.** Phase 5 promises offline mark-paid and offline receipt upload with BackgroundSync. Safari (which half your users will have) doesn't support BackgroundSync. The fallback (in-memory queue, retry on `online`) is lost the moment the tab is backgrounded or the PWA is killed. You are one level more optimistic than the tech allows. Either (a) narrow the offline-writes promise to "response to availability only" for v1 or (b) explicitly test what happens on iOS when a captain backgrounds the app mid-innings and returns.
- **Parallel rollout means two sources of truth for the same state.** A captain marks a player paid on the old official page. Another captain opens the new app — does it reflect that? Yes, because API is shared. But what if the player themselves is looking at charges on the main site? Confirm that every write path on both surfaces invalidates the other's react-query caches. This needs a concrete test matrix during phase 1, not a hand-wave.
- **Passkey invalidation.** PLAN §11 notes this. If even one admin or captain is locked out at the wrong moment, you lose a weekend. Run the passkey-table check _now_ (before phase 1 starts), so if it's non-empty you can batch-communicate with affected users on a timeline, not on the eve of deploy.
- **`match_fee_rate` CRUD endpoint may not exist** (phase 4 deliverables, "Check whether one exists; if not, this is a small backend addition"). "Small backend addition" hiding in an admin UI phase is how schedules slip. Resolve this before phase 4 starts — ideally, during phase 1.

## Missing product thinking

- **No mid-season injury / unavailable-for-the-season flow.** A player breaks a finger in May. Today they presumably just say "unavailable" to each availability request. Fine, but is there a "mark me out until end of July" convenience? Not critical for v1 but worth a sentence in the PLAN clarifying the decision ("no, users respond per-date; seasonal unavailable is out of scope").
- **No fee-dispute flow.** "I paid in cash, why am I being charged?" is a real support burden. Players need a "query this charge" affordance that routes to the treasurer. Currently the plan assumes charges are correct and the player just pays. Even a `mailto:treasurer@...` button on a charge row would close this gap.
- **Juniors playing senior.** PLAN §2 explicitly scopes out juniors — but juniors _do_ sometimes play senior cricket. What role/category do they get? The fee rate lookup (phase 4) has member-category in the key; is there a "junior playing up" category? If not, data will be wrong for those matches. Needs one line of clarification.
- **Guest player charges.** PLAN §11 notes guests don't get fee emails (empty email). Fine — but does the guest still generate a charge in the system? If yes, that charge sits unpaid forever, polluting the treasurer's view. Confirm and document.
- **Opposition/fixture no-show.** `finish` result picker includes A (abandoned) and C (cancelled) but nothing about what happens to fees in those states. Are players charged for an abandoned match? For a concession? This is a business-logic question masquerading as UI, and it'll come up in the first rainy weekend.
- **Onboarding.** First-time a new member opens the app — what do they see? There's no first-run experience. For a volunteer org with member turnover each season this matters more than for a product with continuous user acquisition.

## Proposed v1 success metrics

Define before phase 1, measure from phase 2 onwards:

1. **Availability response rate and latency.** % of invited players who respond within 48h of request being sent, comparing the last two seasons (old surface) against the matchday app once flipped. Target: ≥ 75% within 48h, up from whatever today's baseline is. This is the single most important club-operations metric.
2. **Captain "finish match" completion rate.** % of completed senior matches where `/matchday/:id/finish` was called within 24h of match end. Target: ≥ 90% within 24h. If captains don't finish on the app, the rest of the flow (charges, expenses) backs up onto the treasurer.
3. **Expense reimbursement cycle time.** Median hours from expense submission to reimbursement. Target: halve it versus the current baseline. This is the treasurer's pain — if the admin inbox genuinely speeds them up, it shows here.
4. **PWA install rate among captains and officials.** % of officials who have installed the PWA to home screen within 4 weeks of launch. Target: ≥ 70%. Officials are where the product leverage is.
5. **Active user count per match weekend.** Distinct users hitting the app on a Saturday. Target: ≥ 30 of 50 seniors on a typical match weekend by end of season. Below 20 means rollout has failed and you need to intervene before phase 6.

Add one qualitative metric: a 3-question post-season survey to players and captains separately. Without this, you have no way to catch "it's technically working but people hate it".

## Opinions on specific design calls

- **Flat roles instead of per-match captain permissions.** Right call. Per-match permissions would mean a permissions model, a UI for granting them, and a support burden when they're set wrong. The `matchday_player.is_captain` + `team_official` join gives you 95% of the value with zero new schema. The one thing it costs you is the "captain before roles step" gap — address that as noted above and the decision is clean. **Keep.**
- **Parallel rollout (old + new both live).** Strategically correct but tactically under-specified. The three-stage approach is sound; what's missing is the active-seeding comms I flagged above and the cache-invalidation test matrix across both surfaces. **Keep the strategy, harden the execution.**
- **Admin-only image generation.** Defensible but I'd push back. The stated rationale ("the image represents the club publicly") assumes captains are less trustworthy than admins to pick a match time and home/away flag. In reality captains _know_ the match time — they're the ones playing. Admins are batching the work. You're moving a self-service task from the person-who-has-the-info to the person-who-doesn't, which creates a bottleneck and adds turnaround time on a Friday night when the team news needs posting. Recommendation: **keep it official-level, but scope it to teams the user is a `team_official` of.** That fixes the real concern (an official on 3rd XI shouldn't generate 1st XI news) without creating an admin bottleneck. If that's too much work for v1, admin-only is an acceptable interim, but flag it as an explicit trade-off and revisit in v1.1.
- **Charges staying on main site.** Correct. Re-implementing Stripe UI is a week of work with a sharp edge (PCI-ish, webhook races). The "view in matchday, pay on main site" split is a little clunky but honest. **Keep.**
- **PWA over native.** Obviously right for a volunteer-built app: no app store review, no two codebases, no TestFlight invites for captains. The only thing you give up is push notifications on iOS < 16.4 and aggressive background sync, both of which v1 doesn't promise. **Keep.** Revisit only if push becomes load-bearing _and_ iOS 16.4+ adoption isn't universal yet.

One last note: the plan is better than most plans I review. The "non-goals" list is the best part — those are the decisions that usually blow up scope, and they're explicit here. Execute with the three changes above and this ships well.
