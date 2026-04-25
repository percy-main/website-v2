# 002 — GA4 DebugView validation gate (48h)

**Phase**: 3 — GA4 via gtag.js, no Ads
**Depends on**: 001
**Effort**: S (mostly waiting)

## Context

Before wiring Ads in Phase 4, prove the events flowing to GA4 are correct: right event names, right parameters, right segments, right consent behaviour. 48 hours of real traffic is enough at our volume.

## Scope

### In

- Document a short validation checklist in the ticket commit / PR body.
- Verify in **GA4 DebugView**:
  - `generate_lead` events appear with correct `campaign_id`, `segment` params.
  - `purchase` events appear with `value`/`currency`.
  - `sign_up` events appear.
  - Pageview events have sensible `page_location`/`page_path`.
- Verify **Consent Mode** behaviour:
  - A declined session still records events but without user IDs.
  - A granted session records with full identifiers.
- No Ads account is connected during this phase.

### Out

- Any code change — this is a validation gate.

## Approach

- GA4 DebugView requires enabling `debug_mode: true` on the `gtag` config during validation; turn off before moving on.
- Also spot-check the GA4 Realtime report to confirm events are hitting the live property, not just debug.

## References

- [CONVERSION_TRACKING.md §19 Phase 3 validation gate](../../CONVERSION_TRACKING.md#19-rollout-plan)

## Acceptance

- [ ] 48 hours of live data shows all three events.
- [ ] Consent Mode v2 behaviour verified (accept vs decline).
- [ ] No unknown/unexpected event names in the last 24h.
- [ ] Decision recorded to move to Phase 4.
