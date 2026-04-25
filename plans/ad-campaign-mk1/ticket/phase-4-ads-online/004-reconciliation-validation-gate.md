# 004 — 14-day reconciliation validation gate

**Phase**: 4 — Ads online conversions, soft launch
**Depends on**: 002, 003
**Effort**: S (+14 days wall clock)

## Context

Conversion actions are in Secondary. Run real traffic for 14 days and prove Ads counts match our DB within ±5% before promoting to Primary / Smart Bidding in Phase 6.

## Scope

### In

- A small reconciliation query/script: for the last 14 days, count `marketing_event WHERE type='generate_lead' AND campaign_id='recruit-2026'` grouped by segment + date; compare to the per-campaign / per-day conversion counts in Google Ads (UI or API).
- Spot-check 5 random leads from the DB:
  - `lead.attribution.gclid` is non-null on consent-granted leads.
  - Hashed email was included (checked via gtag DevTools or Ads "User-provided data" diagnostic).
  - Ads diagnostics show the conversion credited to the right conversion action.
- Record the outcome in a short checklist (commit message or PR body).

### Out

- Any code changes to the runtime.

## Approach

- Script can live in `scripts/` as a one-off Node file reading via Kysely; it's throwaway — don't over-invest.
- Reconciliation tolerance: ±5%. Investigate anything outside that before promoting.

## References

- [CONVERSION_TRACKING.md §19 Phase 4 validation gate](../../CONVERSION_TRACKING.md#19-rollout-plan)
- [RECRUIT_CAMPAIGN.md §10 Validation before bidding](../../RECRUIT_CAMPAIGN.md#10-validation-before-bidding-on-these-conversions)

## Acceptance

- [ ] 14 days elapsed since Phase 4 launch.
- [ ] DB vs Ads count reconciliation within ±5% per campaign.
- [ ] 5 spot-checked leads all look correct in Ads diagnostics.
- [ ] Decision to proceed to Phase 5 recorded.
